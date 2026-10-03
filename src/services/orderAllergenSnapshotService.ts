import { DINING_ALLERGIES } from "./diningProfileValidation.js";
import type { AllergenInfoStatus } from "./allergenInfoStatusPolicy.js";

export interface OrderAllergenSnapshotInput {
  items: ReadonlyArray<{ menuItemId: string }>;
  menuItems: ReadonlyArray<{
    id: string;
    allergens?: readonly string[];
    allergenInfoStatus?: AllergenInfoStatus;
  }>;
  reportedAllergies: readonly string[];
}

export type ReportedAllergiesResult =
  | { ok: true; allergies: string[] }
  | { ok: false };

export interface OrderAllergenSnapshot {
  allergenInfoStatus: AllergenInfoStatus;
  allergenWarnings: string[];
}

const allowedAllergies = new Set<string>(DINING_ALLERGIES);

function normalizeAllergen(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeKnownAllergens(values: readonly string[]): string[] | undefined {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") return undefined;
    const allergen = normalizeAllergen(value);
    if (!allowedAllergies.has(allergen)) return undefined;
    if (!seen.has(allergen)) {
      seen.add(allergen);
      normalized.push(allergen);
    }
  }

  return DINING_ALLERGIES.filter((allergen) => seen.has(allergen));
}

export function parseReportedAllergies(value: unknown): ReportedAllergiesResult {
  if (value === undefined) return { ok: true, allergies: [] };
  if (!Array.isArray(value) || value.length > DINING_ALLERGIES.length) {
    return { ok: false };
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") return { ok: false };
    const allergen = normalizeAllergen(entry);
    if (!allowedAllergies.has(allergen) || seen.has(allergen)) {
      return { ok: false };
    }
    seen.add(allergen);
    normalized.push(allergen);
  }

  return {
    ok: true,
    allergies: DINING_ALLERGIES.filter((allergen) => seen.has(allergen))
  };
}

export function buildOrderAllergenSnapshots(
  input: OrderAllergenSnapshotInput
): Map<string, OrderAllergenSnapshot> {
  const menuItemsById = new Map(input.menuItems.map((item) => [item.id, item]));
  const reported = new Set(input.reportedAllergies);
  const snapshots = new Map<string, OrderAllergenSnapshot>();

  for (const { menuItemId } of input.items) {
    if (snapshots.has(menuItemId)) continue;

    const item = menuItemsById.get(menuItemId);
    const declaredAllergens = item && Array.isArray(item.allergens)
      ? normalizeKnownAllergens(item.allergens)
      : undefined;
    const isReviewed = item?.allergenInfoStatus === "REVIEWED" && declaredAllergens !== undefined;

    snapshots.set(menuItemId, {
      allergenInfoStatus: isReviewed ? "REVIEWED" : "UNKNOWN",
      allergenWarnings: isReviewed
        ? declaredAllergens.filter((allergen) => reported.has(allergen))
        : []
    });
  }

  return snapshots;
}
