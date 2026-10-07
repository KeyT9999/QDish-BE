import type { XkiroTranslationMessage } from "./xKiroTranslationClient.js";

export const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";
export const DEFAULT_DEEPSEEK_MODEL_ID = "deepseek-flash";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 800;

export interface DeepSeekTranslationFetcher {
  (input: string, init: RequestInit): Promise<Response>;
}

export interface DeepSeekTranslationClientOptions {
  apiKey?: string;
  modelId?: string;
  fetcher?: DeepSeekTranslationFetcher;
  timeoutMs?: number;
}

export class DeepSeekTranslationClientError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "DEEPSEEK_NOT_CONFIGURED"
      | "DEEPSEEK_TIMEOUT"
      | "DEEPSEEK_REQUEST_FAILED"
      | "DEEPSEEK_UPSTREAM_ERROR"
      | "DEEPSEEK_INVALID_RESPONSE",
    public readonly upstreamStatus?: number
  ) {
    super(message);
    this.name = "DeepSeekTranslationClientError";
  }
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null };
  }>;
}

export function createDeepSeekTranslationClient(options: DeepSeekTranslationClientOptions = {}) {
  const fetcher = options.fetcher ?? fetch;

  return {
    async complete(messages: XkiroTranslationMessage[]): Promise<string> {
      const configuredApiKey = options.apiKey === undefined ? process.env.DEEPSEEK_API_KEY : options.apiKey;
      const apiKey = configuredApiKey?.trim();
      if (!apiKey) {
        throw new DeepSeekTranslationClientError("DeepSeek is not configured.", "DEEPSEEK_NOT_CONFIGURED");
      }

      const modelId = options.modelId?.trim() || process.env.DEEPSEEK_MODEL_ID?.trim() || DEFAULT_DEEPSEEK_MODEL_ID;
      const controller = new AbortController();
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetcher(DEEPSEEK_CHAT_COMPLETIONS_URL, {
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
            thinking: { type: "disabled" },
            stream: false
          }),
          signal: controller.signal
        });
      } catch {
        clearTimeout(timeoutId);
        if (timedOut) {
          throw new DeepSeekTranslationClientError("DeepSeek request timed out.", "DEEPSEEK_TIMEOUT");
        }
        throw new DeepSeekTranslationClientError("DeepSeek request failed.", "DEEPSEEK_REQUEST_FAILED");
      }

      if (timedOut) {
        clearTimeout(timeoutId);
        throw new DeepSeekTranslationClientError("DeepSeek request timed out.", "DEEPSEEK_TIMEOUT");
      }
      if (!response.ok) {
        clearTimeout(timeoutId);
        throw new DeepSeekTranslationClientError(
          "DeepSeek returned an error.",
          "DEEPSEEK_UPSTREAM_ERROR",
          response.status
        );
      }

      try {
        const payload = await response.json() as ChatCompletionResponse;
        clearTimeout(timeoutId);
        if (timedOut) {
          throw new DeepSeekTranslationClientError("DeepSeek request timed out.", "DEEPSEEK_TIMEOUT");
        }

        const choice = payload?.choices?.[0];
        const content = choice?.message?.content;
        if (choice?.finish_reason === "length" || typeof content !== "string" || !content.trim()) {
          throw new DeepSeekTranslationClientError("DeepSeek returned an invalid response.", "DEEPSEEK_INVALID_RESPONSE");
        }
        return content;
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof DeepSeekTranslationClientError) throw error;
        if (timedOut) {
          throw new DeepSeekTranslationClientError("DeepSeek request timed out.", "DEEPSEEK_TIMEOUT");
        }
        throw new DeepSeekTranslationClientError("DeepSeek returned an invalid response.", "DEEPSEEK_INVALID_RESPONSE");
      }
    }
  };
}
