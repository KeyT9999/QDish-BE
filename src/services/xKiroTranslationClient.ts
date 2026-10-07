export const XKIRO_CHAT_COMPLETIONS_URL = "https://api.xkiro.com/v1/chat/completions";
export const DEFAULT_XKIRO_MODEL_ID = "qwen/qwen3.8-max";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 800;

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
}

export class XkiroTranslationClientError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "XKIRO_NOT_CONFIGURED"
      | "XKIRO_TIMEOUT"
      | "XKIRO_REQUEST_FAILED"
      | "XKIRO_UPSTREAM_ERROR"
      | "XKIRO_INVALID_RESPONSE"
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

export function createXKiroTranslationClient(options: XkiroTranslationClientOptions = {}) {
  const fetcher = options.fetcher ?? fetch;

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
      const controller = new AbortController();
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      try {
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
          if (timedOut) {
            throw new XkiroTranslationClientError("Translation provider timed out.", "XKIRO_TIMEOUT");
          }
          throw new XkiroTranslationClientError("Translation provider request failed.", "XKIRO_REQUEST_FAILED");
        }

        if (timedOut) {
          throw new XkiroTranslationClientError("Translation provider timed out.", "XKIRO_TIMEOUT");
        }
        if (!response.ok) {
          throw new XkiroTranslationClientError("Translation provider returned an error.", "XKIRO_UPSTREAM_ERROR");
        }

        let payload: ChatCompletionResponse;
        try {
          payload = await response.json() as ChatCompletionResponse;
        } catch {
          if (timedOut) {
            throw new XkiroTranslationClientError("Translation provider timed out.", "XKIRO_TIMEOUT");
          }
          throw new XkiroTranslationClientError("Translation provider returned an invalid response.", "XKIRO_INVALID_RESPONSE");
        }

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
        if (error instanceof XkiroTranslationClientError) throw error;
        if (timedOut) {
          throw new XkiroTranslationClientError("Translation provider timed out.", "XKIRO_TIMEOUT");
        }
        throw new XkiroTranslationClientError("Translation provider request failed.", "XKIRO_REQUEST_FAILED");
      } finally {
        clearTimeout(timeoutId);
      }
    }
  };
}
