export type AllergenInfoStatus = "UNKNOWN" | "REVIEWED";

export function normalizeAllergenInfoStatus(value: unknown): AllergenInfoStatus {
  return value === "REVIEWED" ? "REVIEWED" : "UNKNOWN";
}

export function resolveAllergenInfoStatusUpdate(
  recipeChanged: boolean,
  requestedStatus: unknown
): { ok: true; status: AllergenInfoStatus | undefined } | { ok: false } {
  if (requestedStatus !== undefined && requestedStatus !== "UNKNOWN" && requestedStatus !== "REVIEWED") {
    return { ok: false };
  }

  if (recipeChanged) return { ok: true, status: "UNKNOWN" };
  return { ok: true, status: requestedStatus as AllergenInfoStatus | undefined };
}

export function invalidateAllergenReview<T extends { allergenInfoStatus?: AllergenInfoStatus }>(item: T): void {
  item.allergenInfoStatus = "UNKNOWN";
}
