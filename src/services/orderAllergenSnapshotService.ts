import { DINING_ALLERGIES } from "./diningProfileValidation.js";
import { ALLERGEN_CODES, normalizeAllergenCodes } from "./allergenSafetyService.js";
import type { AllergenInfoStatus } from "./allergenInfoStatusPolicy.js";

export interface OrderAllergenSnapshotInput {
  items: ReadonlyArray<{ menuItemId: string }>;
  menuItems: ReadonlyArray<{
    id: string;
    allergens?: readonly string[];
    reviewedAllergens?: readonly string[];
    mayContainAllergens?: readonly string[];
    allergenInfoStatus?: AllergenInfoStatus;
    hasReviewEvidence?: boolean;
  }>;
  reportedAllergies: readonly string[];
}

export type ReportedAllergiesResult =
  | { ok: true; allergies: string[] }
  | { ok: false };

export type AllergyDisclosureStatus = "NOT_ANSWERED" | "NONE_DECLARED" | "DECLARED";

export interface OrderAllergenSnapshot {
  allergenInfoStatus: AllergenInfoStatus;
  allergenWarnings: string[];
  allergenContainsWarnings: string[];
  allergenMayContainWarnings: string[];
  allergenWarningSource?: "CANDIDATE" | "CONTAINS" | "MAY_CONTAIN" | "MIXED";
  allergenInformationIncomplete: boolean;
}

export interface OrderItemSnapshotInput {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
}

export type PersistedOrderItem = OrderItemSnapshotInput & OrderAllergenSnapshot;

const allowedAllergies = new Set<string>(DINING_ALLERGIES);

function normalizeAllergen(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeKnownAllergens(values: readonly string[]): string[] | undefined {
  if (values.some((value) => !allowedAllergies.has(normalizeAllergen(value)))) return undefined;
  return normalizeAllergenCodes(values);
}

function normalizeSupportedAllergens(values: readonly unknown[]): string[] {
  const supported = values.filter((value): value is string =>
    typeof value === "string" && allowedAllergies.has(normalizeAllergen(value))
  );
  return normalizeAllergenCodes(supported) ?? [];
}

export function parseReportedAllergies(value: unknown): ReportedAllergiesResult {
  if (value === undefined) return { ok: true, allergies: [] };
  if (!Array.isArray(value) || value.length > DINING_ALLERGIES.length) {
    return { ok: false };
  }

  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") return { ok: false };
    const allergen = normalizeAllergen(entry);
    if (!allowedAllergies.has(allergen) || seen.has(allergen)) {
      return { ok: false };
    }
    seen.add(allergen);
  }

  const normalized = normalizeAllergenCodes([...seen]);
  if (!normalized) return { ok: false };

  return {
    ok: true,
    allergies: ALLERGEN_CODES.filter((allergen) => normalized.includes(allergen))
  };
}

export function parseAllergyDisclosureStatus(
  value: unknown,
  reportedAllergies: readonly string[]
): { ok: true; value: AllergyDisclosureStatus } | { ok: false } {
  if (value === undefined) {
    return { ok: true, value: reportedAllergies.length > 0 ? "DECLARED" : "NOT_ANSWERED" };
  }
  if (value !== "NOT_ANSWERED" && value !== "NONE_DECLARED" && value !== "DECLARED") {
    return { ok: false };
  }
  if ((value === "DECLARED") !== (reportedAllergies.length > 0)) return { ok: false };
  return { ok: true, value };
}

export function buildOrderAllergenSnapshots(
  input: OrderAllergenSnapshotInput
): Map<string, OrderAllergenSnapshot> {
  const menuItemsById = new Map(input.menuItems.map((item) => [item.id, item]));
  const reported = new Set(normalizeAllergenCodes(input.reportedAllergies) ?? []);
  const snapshots = new Map<string, OrderAllergenSnapshot>();

  for (const { menuItemId } of input.items) {
    if (snapshots.has(menuItemId)) continue;

    const item = menuItemsById.get(menuItemId);
    const candidateAllergens = item && Array.isArray(item.allergens)
      ? normalizeSupportedAllergens(item.allergens)
      : undefined;
    const reviewedAllergens = item && Array.isArray(item.reviewedAllergens)
      ? normalizeKnownAllergens(item.reviewedAllergens)
      : undefined;
    const mayContainAllergens = item && Array.isArray(item.mayContainAllergens)
      ? normalizeKnownAllergens(item.mayContainAllergens)
      : undefined;
    const isReviewed = item?.allergenInfoStatus === "REVIEWED"
      && item.hasReviewEvidence === true
      && reviewedAllergens !== undefined
      && mayContainAllergens !== undefined
      && !reviewedAllergens.some((allergen) => mayContainAllergens.includes(allergen));
    const containsConflicts = isReviewed ? reviewedAllergens.filter((allergen) => reported.has(allergen)) : [];
    const mayContainConflicts = isReviewed ? mayContainAllergens.filter((allergen) => reported.has(allergen)) : [];
    const candidateConflicts = !isReviewed
      ? (candidateAllergens ?? []).filter((allergen) => reported.has(allergen))
      : [];
    const warnings = isReviewed
      ? ALLERGEN_CODES.filter((allergen) => containsConflicts.includes(allergen) || mayContainConflicts.includes(allergen))
      : candidateConflicts;
    const warningSource = !isReviewed
      ? (candidateConflicts.length > 0 ? "CANDIDATE" as const : undefined)
      : containsConflicts.length > 0 && mayContainConflicts.length > 0
        ? "MIXED" as const
        : containsConflicts.length > 0 ? "CONTAINS" as const
          : mayContainConflicts.length > 0 ? "MAY_CONTAIN" as const : undefined;

    snapshots.set(menuItemId, {
      allergenInfoStatus: isReviewed ? "REVIEWED" : "UNKNOWN",
      allergenWarnings: warnings,
      allergenContainsWarnings: isReviewed ? containsConflicts : [],
      allergenMayContainWarnings: isReviewed ? mayContainConflicts : [],
      ...(warningSource ? { allergenWarningSource: warningSource } : {}),
      allergenInformationIncomplete: !isReviewed
    });
  }

  return snapshots;
}

export function snapshotOrderItems<T extends OrderItemSnapshotInput>(
  items: readonly T[],
  snapshots: ReadonlyMap<string, OrderAllergenSnapshot>
): PersistedOrderItem[] {
  return items.map(({ menuItemId, name, price, quantity }) => ({
    menuItemId,
    name,
    price,
    quantity,
    ...(snapshots.get(menuItemId) ?? {
      allergenInfoStatus: "UNKNOWN" as const,
      allergenWarnings: [],
      allergenContainsWarnings: [],
      allergenMayContainWarnings: [],
      allergenInformationIncomplete: true
    })
  }));
}

export function resolveOrderReportedAllergies(
  _items: readonly Pick<PersistedOrderItem, "allergenInfoStatus">[],
  reportedAllergies: readonly string[]
): string[] | undefined {
  const normalized = normalizeAllergenCodes(reportedAllergies) ?? [];
  return normalized.length === 0 ? undefined : normalized;
}
