export const XKIRO_CHAT_COMPLETIONS_URL = "https://api.xkiro.com/v1/chat/completions";
export const DEFAULT_XKIRO_MODEL_ID = "qwen/qwen3.8-max";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 800;
const MAX_UPSTREAM_ATTEMPTS = 3;
const MAX_AUTOMATIC_RETRY_WAIT_MS = 30_000;
const RETRYABLE_UPSTREAM_STATUSES = new Set([429, 500, 502, 503, 529]);

export interface XkiroTranslationMessage {
  role: "system" | "user";
  content: string;
}

export interface XkiroTranslationFetcher {
  (input: string, init: RequestInit): Promise<Response>;
}

export interface XkiroTranslationClientOptions {
  apiKey?: string;
  modelId?: string;
  fetcher?: XkiroTranslationFetcher;
  timeoutMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

export class XkiroTranslationClientError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "XKIRO_NOT_CONFIGURED"
      | "XKIRO_TIMEOUT"
      | "XKIRO_REQUEST_FAILED"
      | "XKIRO_UPSTREAM_ERROR"
      | "XKIRO_INVALID_RESPONSE",
    public readonly upstreamStatus?: number,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "XkiroTranslationClientError";
  }
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null };
  }>;
}

function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, (date - Date.now()) / 1000);
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createXKiroTranslationClient(options: XkiroTranslationClientOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const wait = options.wait ?? defaultWait;

  return {
    async complete(messages: XkiroTranslationMessage[]): Promise<string> {
      const configuredApiKey = options.apiKey === undefined ? process.env.XKIRO_API_KEY : options.apiKey;
      const apiKey = configuredApiKey?.trim();
      if (!apiKey) {
        throw new XkiroTranslationClientError(
          "Translation provider is not configured.",
          "XKIRO_NOT_CONFIGURED"
        );
      }

      const modelId = options.modelId?.trim() || process.env.XKIRO_MODEL_ID?.trim() || DEFAULT_XKIRO_MODEL_ID;
      for (let attempt = 1; attempt <= MAX_UPSTREAM_ATTEMPTS; attempt += 1) {
        const controller = new AbortController();
        let timedOut = false;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

        let response: Response;
        try {
          response = await fetcher(XKIRO_CHAT_COMPLETIONS_URL, {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json"
            },
            body: JSON.stringify({
              model: modelId,
              messages,
              response_format: { type: "json_object" },
              max_tokens: MAX_OUTPUT_TOKENS,
              stream: false
            }),
            signal: controller.signal
          });
        } catch {
          clearTimeout(timeoutId);
          if (timedOut) {
            throw new XkiroTranslationClientError("Translation provider timed out.", "XKIRO_TIMEOUT");
          }
          throw new XkiroTranslationClientError("Translation provider request failed.", "XKIRO_REQUEST_FAILED");
        }

        if (timedOut) {
          clearTimeout(timeoutId);
          throw new XkiroTranslationClientError("Translation provider timed out.", "XKIRO_TIMEOUT");
        }
        if (!response.ok) {
          const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
          const retryDelayMs = retryAfterSeconds === undefined
            ? Math.min(1_000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250), 5_000)
            : retryAfterSeconds * 1_000;
          clearTimeout(timeoutId);

          if (RETRYABLE_UPSTREAM_STATUSES.has(response.status)
            && attempt < MAX_UPSTREAM_ATTEMPTS
            && retryDelayMs <= MAX_AUTOMATIC_RETRY_WAIT_MS) {
            await response.body?.cancel().catch(() => undefined);
            await wait(retryDelayMs);
            continue;
          }

          throw new XkiroTranslationClientError(
            "Translation provider returned an error.",
            "XKIRO_UPSTREAM_ERROR",
            response.status,
            retryAfterSeconds
          );
        }

        try {
          const payload = await response.json() as ChatCompletionResponse;
          clearTimeout(timeoutId);
          if (timedOut) {
            throw new XkiroTranslationClientError("Translation provider timed out.", "XKIRO_TIMEOUT");
          }

          const choice = payload?.choices?.[0];
          const content = choice?.message?.content;
          if (choice?.finish_reason === "length" || typeof content !== "string" || !content.trim()) {
            throw new XkiroTranslationClientError("Translation provider returned an invalid response.", "XKIRO_INVALID_RESPONSE");
          }
          return content;
        } catch (error) {
          clearTimeout(timeoutId);
          if (error instanceof XkiroTranslationClientError) throw error;
          if (timedOut) {
            throw new XkiroTranslationClientError("Translation provider timed out.", "XKIRO_TIMEOUT");
          }
          throw new XkiroTranslationClientError("Translation provider returned an invalid response.", "XKIRO_INVALID_RESPONSE");
        }
      }

      throw new XkiroTranslationClientError("Translation provider returned an error.", "XKIRO_UPSTREAM_ERROR");
    }
  };
}
