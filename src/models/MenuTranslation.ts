export const MENU_TRANSLATION_LOCALES = ["en", "zhCN"] as const;

export type MenuTranslationLocale = typeof MENU_TRANSLATION_LOCALES[number];
export type TranslationPublicationStatus = "APPROVED" | "STALE";
export type TranslationDisplayStatus = "DRAFT" | TranslationPublicationStatus;

export interface MenuItemTranslationValue {
  name: string;
  description: string;
}

export interface CategoryTranslationValue {
  name: string;
}

export interface TranslationEntry<T> {
  approved?: {
    value: T;
    status: TranslationPublicationStatus;
  };
  draft?: {
    value: T;
    generatedAt: Date;
  };
}

export type LocaleTranslationMap<T> = Partial<Record<MenuTranslationLocale, TranslationEntry<T>>>;
export type MenuItemTranslations = LocaleTranslationMap<MenuItemTranslationValue>;
export type CategoryTranslations = LocaleTranslationMap<CategoryTranslationValue>;
