import { normalizeAllergenCodes } from "./allergenSafetyService.js";

export const MENU_ALLERGEN_REVIEW_SOURCE_TYPES = [
  "SUPPLIER_LABEL",
  "RESTAURANT_RECIPE",
  "STAFF_ATTESTATION"
] as const;

export type MenuAllergenReviewMethod = "RECIPE" | "MANUAL";
export type MenuAllergenReviewSourceType = typeof MENU_ALLERGEN_REVIEW_SOURCE_TYPES[number];

export interface MenuAllergenReviewEvidenceInput {
  method?: unknown;
  sourceType?: unknown;
  sourceNote?: unknown;
  reviewerId?: unknown;
  reviewedAt?: unknown;
}

export function hasMenuAllergenReviewEvidence(input: MenuAllergenReviewEvidenceInput): boolean {
  if (input.method !== "RECIPE" && input.method !== "MANUAL") return false;
  if (!MENU_ALLERGEN_REVIEW_SOURCE_TYPES.includes(input.sourceType as MenuAllergenReviewSourceType)) return false;
  if (input.method === "RECIPE" && input.sourceType !== "RESTAURANT_RECIPE") return false;
  if (typeof input.sourceNote !== "string" || input.sourceNote.trim().length === 0 || input.sourceNote.trim().length > 500) return false;
  if (!input.reviewerId) return false;
  const reviewedAt = input.reviewedAt instanceof Date
    ? input.reviewedAt
    : typeof input.reviewedAt === "string" ? new Date(input.reviewedAt) : undefined;
  return Boolean(reviewedAt && !Number.isNaN(reviewedAt.getTime()));
}

export interface MenuAllergenReviewRecord {
  ingredients?: readonly unknown[];
  allergenCoverageStatus?: "UNKNOWN" | "INCOMPLETE" | "COMPLETE";
  allergenUnverifiedIngredientCount?: number;
  recipeIngredientsReviewed?: boolean;
}

export interface MenuAllergenReviewInput {
  method?: unknown;
  containsAllergens?: unknown;
  mayContainAllergens?: unknown;
  sourceType?: unknown;
  sourceNote?: unknown;
  reviewerId: string;
  now: Date;
}

export type MenuAllergenReviewResult =
  | {
      ok: true;
      value: {
        method: MenuAllergenReviewMethod;
        containsAllergens: string[];
        mayContainAllergens: string[];
        sourceType: MenuAllergenReviewSourceType;
        sourceNote: string;
        reviewerId: string;
        reviewedAt: Date;
      };
    }
  | { ok: false; reason: "INVALID_METHOD" | "INVALID_ALLERGENS" | "OVERLAPPING_LISTS" | "INVALID_SOURCE" | "MISSING_EVIDENCE" | "RECIPE_NOT_COMPLETE" };

function parseAllergenList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return undefined;
  const entries = value as string[];
  const normalized = normalizeAllergenCodes(entries);
  if (!normalized) return undefined;
  const raw = entries.map((code) => code.trim().toUpperCase());
  if (new Set(raw).size !== raw.length) return undefined;
  // NUTS expands into two codes, so compare the normalized list to ensure
  // callers cannot submit aliases that duplicate a canonical declaration.
  const expandedCount = raw.reduce((count, code) => count + (code === "NUTS" ? 2 : 1), 0);
  if (normalized.length !== expandedCount) return undefined;
  return normalized;
}

export function resolveMenuAllergenReview(
  menu: MenuAllergenReviewRecord,
  input: MenuAllergenReviewInput
): MenuAllergenReviewResult {
  if (input.method !== "RECIPE" && input.method !== "MANUAL") {
    return { ok: false, reason: "INVALID_METHOD" };
  }
  if (input.method === "RECIPE" && (
    !Array.isArray(menu.ingredients)
    || menu.ingredients.length === 0
    || menu.allergenCoverageStatus !== "COMPLETE"
    || (menu.allergenUnverifiedIngredientCount ?? 0) !== 0
    || menu.recipeIngredientsReviewed !== true
  )) {
    return { ok: false, reason: "RECIPE_NOT_COMPLETE" };
  }

  const containsAllergens = parseAllergenList(input.containsAllergens);
  const mayContainAllergens = parseAllergenList(input.mayContainAllergens);
  if (!containsAllergens || !mayContainAllergens) return { ok: false, reason: "INVALID_ALLERGENS" };
  if (containsAllergens.some((code) => mayContainAllergens.includes(code))) {
    return { ok: false, reason: "OVERLAPPING_LISTS" };
  }

  if (!MENU_ALLERGEN_REVIEW_SOURCE_TYPES.includes(input.sourceType as MenuAllergenReviewSourceType)) {
    return { ok: false, reason: "INVALID_SOURCE" };
  }
  const sourceType = input.sourceType as MenuAllergenReviewSourceType;
  if (input.method === "RECIPE" && sourceType !== "RESTAURANT_RECIPE") {
    return { ok: false, reason: "INVALID_SOURCE" };
  }
  const sourceNote = typeof input.sourceNote === "string" ? input.sourceNote.trim() : "";
  if (
    sourceNote.length === 0
    || sourceNote.length > 500
    || !input.reviewerId
    || Number.isNaN(input.now.getTime())
  ) {
    return { ok: false, reason: "MISSING_EVIDENCE" };
  }

  return {
    ok: true,
    value: {
      method: input.method,
      containsAllergens,
      mayContainAllergens,
      sourceType,
      sourceNote,
      reviewerId: input.reviewerId,
      reviewedAt: input.now
    }
  };
}

