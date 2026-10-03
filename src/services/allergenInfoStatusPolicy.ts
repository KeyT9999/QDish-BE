export type AllergenInfoStatus = "UNKNOWN" | "REVIEWED";

export function normalizeAllergenInfoStatus(value: unknown): AllergenInfoStatus {
  return value === "REVIEWED" ? "REVIEWED" : "UNKNOWN";
}

export function resolveAllergenInfoStatusUpdate(
  recipeChanged: boolean,
  requestedStatus: unknown
): { ok: true; status: AllergenInfoStatus | undefined } | { ok: false } {
  // REVIEWED is only reachable through the evidence-validated review endpoint.
  if (requestedStatus !== undefined && requestedStatus !== "UNKNOWN" && requestedStatus !== "REVIEWED") {
    return { ok: false };
  }

  if (recipeChanged) return { ok: true, status: "UNKNOWN" };
  if (requestedStatus === "REVIEWED") return { ok: false };
  return { ok: true, status: requestedStatus as AllergenInfoStatus | undefined };
}

export function invalidateAllergenReview<T extends {
  allergenInfoStatus?: AllergenInfoStatus;
  reviewedAllergens?: string[];
  mayContainAllergens?: string[];
  allergenReviewMethod?: "RECIPE" | "MANUAL";
  allergenReviewSourceType?: string;
  allergenReviewSourceNote?: string;
  allergenReviewedBy?: unknown;
  allergenReviewedAt?: Date;
}>(item: T): void {
  item.allergenInfoStatus = "UNKNOWN";
  item.reviewedAllergens = [];
  item.mayContainAllergens = [];
  item.allergenReviewMethod = undefined;
  item.allergenReviewSourceType = undefined;
  item.allergenReviewSourceNote = undefined;
  item.allergenReviewedBy = undefined;
  item.allergenReviewedAt = undefined;
}
