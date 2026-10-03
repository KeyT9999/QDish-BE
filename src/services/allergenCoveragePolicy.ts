export type AllergenCoverageStatus = "UNKNOWN" | "INCOMPLETE" | "COMPLETE";

export interface AllergenCoverageSummary {
  status: AllergenCoverageStatus;
  unverifiedIngredientCount: number;
  missingIngredientCount: number;
}

export function resolveAllergenCoverage(input: {
  requestedIngredientCount: number;
  resolvedIngredientCount: number;
  unverifiedIngredientCount: number;
}): AllergenCoverageSummary {
  const requested = Math.max(0, input.requestedIngredientCount);
  const resolved = Math.min(requested, Math.max(0, input.resolvedIngredientCount));
  const unverified = Math.max(0, input.unverifiedIngredientCount);
  const missing = requested - resolved;
  if (requested === 0) {
    return { status: "UNKNOWN", unverifiedIngredientCount: 0, missingIngredientCount: 0 };
  }
  return {
    status: missing === 0 && unverified === 0 ? "COMPLETE" : "INCOMPLETE",
    unverifiedIngredientCount: unverified,
    missingIngredientCount: missing
  };
}
