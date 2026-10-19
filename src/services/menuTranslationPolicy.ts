import type {
  CategoryTranslations,
  LocaleTranslationMap,
  ManagedLocaleTranslationMap,
  MenuItemTranslations,
  TranslationEntry
} from "../models/MenuTranslation.js";
import { MENU_TRANSLATION_LOCALES } from "../models/MenuTranslation.js";

export function filterApprovedTranslations<T>(
  translations?: LocaleTranslationMap<T>
): Partial<Record<(typeof MENU_TRANSLATION_LOCALES)[number], T>> {
  const publicTranslations: Partial<Record<(typeof MENU_TRANSLATION_LOCALES)[number], T>> = {};

  for (const locale of MENU_TRANSLATION_LOCALES) {
    const approved = translations?.[locale]?.approved;
    if (approved?.status === "APPROVED") {
      publicTranslations[locale] = approved.value;
    }
  }

  return publicTranslations;
}

export function serializeManagedTranslations<T>(
  translations?: LocaleTranslationMap<T>
): ManagedLocaleTranslationMap<T> {
  const managedTranslations: ManagedLocaleTranslationMap<T> = {};

  for (const locale of MENU_TRANSLATION_LOCALES) {
    const entry = translations?.[locale];
    if (!entry?.approved && !entry?.draft) continue;

    managedTranslations[locale] = {
      ...(entry.approved ? { approved: entry.approved } : {}),
      ...(entry.draft ? { draft: entry.draft } : {}),
      displayStatus: entry.draft ? "DRAFT" : entry.approved!.status
    };
  }

  return managedTranslations;
}

function markApprovedValuesStale<T>(
  translations?: LocaleTranslationMap<T>
): LocaleTranslationMap<T> {
  const staleTranslations: LocaleTranslationMap<T> = {};

  for (const locale of MENU_TRANSLATION_LOCALES) {
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
