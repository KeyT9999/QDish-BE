import { normalizeAllergenCodes } from "./allergenSafetyService.js";

export const ALLERGEN_EVIDENCE_SOURCE_TYPES = [
  "SUPPLIER_LABEL",
  "RESTAURANT_RECIPE",
  "STAFF_ATTESTATION",
  "CURATED_MENU_DESCRIPTION"
] as const;

export type AllergenEvidenceSourceType = typeof ALLERGEN_EVIDENCE_SOURCE_TYPES[number];

export interface IngredientAllergenPolicyRecord {
  allergens?: readonly string[];
  allergenInfoStatus?: "UNKNOWN" | "REVIEWED";
  allergenInfoSourceType?: AllergenEvidenceSourceType | "CURATED_REFERENCE_CATALOG";
  allergenInfoSourceNote?: string;
  allergenReviewedBy?: unknown;
  allergenReviewedAt?: Date | string;
}

export interface IngredientAllergenPolicyInput {
  allergens?: unknown;
  allergenInfoStatus?: unknown;
  allergenInfoSourceType?: unknown;
  allergenInfoSourceNote?: unknown;
  reviewerId: string;
  now: Date;
}

export type IngredientAllergenPolicyResult =
  | {
      ok: true;
      value: IngredientAllergenPolicyRecord & {
        allergens: string[];
        allergenInfoStatus: "UNKNOWN" | "REVIEWED";
        allergenReviewedAt?: Date;
        changed: boolean;
      };
    }
  | { ok: false; reason: "INVALID_ALLERGENS" | "INVALID_STATUS" | "MISSING_EVIDENCE" };

function normalizeList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return undefined;
  const codes = value as string[];
  const normalized = normalizeAllergenCodes(codes);
  if (!normalized) return undefined;
  const submitted = codes.map((code) => code.trim().toUpperCase());
  if (new Set(submitted).size !== submitted.length) return undefined;
  const expandedCount = submitted.reduce((count, code) => count + (code === "NUTS" ? 2 : 1), 0);
  if (normalized.length !== expandedCount) return undefined;
  return normalized;
}

function sameCodes(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((code, index) => code === right[index]);
}

function clearReviewFields() {
  return {
    allergenInfoSourceType: undefined,
    allergenInfoSourceNote: undefined,
    allergenReviewedBy: undefined,
    allergenReviewedAt: undefined
  };
}

function parseReviewedAt(value: Date | string | undefined): Date | undefined {
  const reviewedAt = value instanceof Date
    ? value
    : typeof value === "string" ? new Date(value) : undefined;
  return reviewedAt && !Number.isNaN(reviewedAt.getTime()) ? reviewedAt : undefined;
}

export function hasVerifiedIngredientAllergenEvidence(record: IngredientAllergenPolicyRecord): boolean {
  const sourceNoteLength = record.allergenInfoSourceNote?.trim().length ?? 0;
  return record.allergenInfoStatus === "REVIEWED"
    && ALLERGEN_EVIDENCE_SOURCE_TYPES.includes(record.allergenInfoSourceType as AllergenEvidenceSourceType)
    && sourceNoteLength > 0
    && sourceNoteLength <= 500
    && Boolean(record.allergenReviewedBy)
    && Boolean(parseReviewedAt(record.allergenReviewedAt))
    && normalizeList(record.allergens ?? []) !== undefined;
}

export function resolveIngredientAllergenUpdate(
  current: IngredientAllergenPolicyRecord,
  input: IngredientAllergenPolicyInput
): IngredientAllergenPolicyResult {
  const currentAllergens = normalizeList(current.allergens ?? []) ?? [];
  const allergens = input.allergens === undefined ? currentAllergens : normalizeList(input.allergens);
  if (!allergens) return { ok: false, reason: "INVALID_ALLERGENS" };

  const status = input.allergenInfoStatus;
  if (status !== undefined && status !== "UNKNOWN" && status !== "REVIEWED") {
    return { ok: false, reason: "INVALID_STATUS" };
  }

  const changed = !sameCodes(currentAllergens, allergens);
  if (status === "REVIEWED") {
    const sourceType = input.allergenInfoSourceType;
    const sourceNote = typeof input.allergenInfoSourceNote === "string" ? input.allergenInfoSourceNote.trim() : "";
    if (
      !ALLERGEN_EVIDENCE_SOURCE_TYPES.includes(sourceType as AllergenEvidenceSourceType)
      || input.allergens === undefined
      || sourceNote.length === 0
      || sourceNote.length > 500
      || !input.reviewerId
      || Number.isNaN(input.now.getTime())
    ) {
      return { ok: false, reason: "MISSING_EVIDENCE" };
    }

    return {
      ok: true,
      value: {
        allergens,
        allergenInfoStatus: "REVIEWED",
        allergenInfoSourceType: sourceType as AllergenEvidenceSourceType,
        allergenInfoSourceNote: sourceNote,
        allergenReviewedBy: input.reviewerId,
        allergenReviewedAt: input.now,
        changed: changed
          || current.allergenInfoStatus !== "REVIEWED"
          || current.allergenInfoSourceType !== sourceType
          || current.allergenInfoSourceNote !== sourceNote
      }
    };
  }

  if (status === "UNKNOWN" || changed) {
    return {
      ok: true,
      value: {
        allergens,
        allergenInfoStatus: "UNKNOWN",
        ...clearReviewFields(),
        changed: changed || current.allergenInfoStatus !== "UNKNOWN"
      }
    };
  }

  if (current.allergenInfoStatus === "REVIEWED" && !hasVerifiedIngredientAllergenEvidence(current)) {
    return {
      ok: true,
      value: {
        allergens,
        allergenInfoStatus: "UNKNOWN",
        ...clearReviewFields(),
        changed: true
      }
    };
  }

  if (current.allergenInfoStatus !== "REVIEWED") {
    return {
      ok: true,
      value: {
        allergens,
        allergenInfoStatus: "UNKNOWN",
        allergenInfoSourceType: current.allergenInfoSourceType,
        allergenInfoSourceNote: current.allergenInfoSourceNote,
        changed: false
      }
    };
  }

  return {
    ok: true,
    value: {
      allergens,
      allergenInfoStatus: "REVIEWED",
      allergenInfoSourceType: current.allergenInfoSourceType,
      allergenInfoSourceNote: current.allergenInfoSourceNote,
      allergenReviewedBy: current.allergenReviewedBy,
      allergenReviewedAt: parseReviewedAt(current.allergenReviewedAt),
      changed: false
    }
  };
}
