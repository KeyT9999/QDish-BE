import type {
  CategoryTranslations,
  LocaleTranslationMap,
  MenuItemTranslations,
  TranslationEntry
} from "../models/MenuTranslation.js";

export function filterApprovedTranslations<T>(
  translations?: LocaleTranslationMap<T>
): Partial<Record<"en" | "zhCN", T>> {
  const publicTranslations: Partial<Record<"en" | "zhCN", T>> = {};

  for (const locale of ["en", "zhCN"] as const) {
    const approved = translations?.[locale]?.approved;
    if (approved?.status === "APPROVED") {
      publicTranslations[locale] = approved.value;
    }
  }

  return publicTranslations;
}

function markApprovedValuesStale<T>(
  translations?: LocaleTranslationMap<T>
): LocaleTranslationMap<T> {
  const staleTranslations: LocaleTranslationMap<T> = {};

  for (const locale of ["en", "zhCN"] as const) {
    const approved = translations?.[locale]?.approved;
    if (!approved) continue;

    const entry: TranslationEntry<T> = {
      approved: {
        value: approved.value,
        status: "STALE"
      }
    };
    staleTranslations[locale] = entry;
  }

  return staleTranslations;
}

export function markMenuTranslationsStale(translations?: MenuItemTranslations): MenuItemTranslations {
  return markApprovedValuesStale(translations);
}

export function markCategoryTranslationsStale(translations?: CategoryTranslations): CategoryTranslations {
  return markApprovedValuesStale(translations);
}
