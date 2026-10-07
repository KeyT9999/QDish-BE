import type { XkiroTranslationMessage } from "./xKiroTranslationClient.js";

export interface TranslationCompletionClient {
  complete(messages: XkiroTranslationMessage[]): Promise<string>;
}

export class TranslationProviderFailoverError extends Error {
  readonly code = "TRANSLATION_PROVIDER_FAILOVER_UNAVAILABLE";

  constructor(
    public readonly primaryError: unknown,
    public readonly fallbackError: unknown
  ) {
    super("Primary and fallback translation providers failed.");
    this.name = "TranslationProviderFailoverError";
  }
}

export function createTranslationProviderFailoverClient(
  primary: TranslationCompletionClient,
  fallback: TranslationCompletionClient,
  isFallbackConfigured: () => boolean = () => Boolean(process.env.DEEPSEEK_API_KEY?.trim())
): TranslationCompletionClient {
  return {
    async complete(messages) {
      try {
        return await primary.complete(messages);
      } catch (primaryError) {
        if (!isFallbackConfigured()) throw primaryError;
        try {
          return await fallback.complete(messages);
        } catch (fallbackError) {
          throw new TranslationProviderFailoverError(primaryError, fallbackError);
        }
      }
    }
  };
}
