import type { IDishNutritionProfile } from "../models/DishNutritionProfile.js";
import type { IMenuItem } from "../models/MenuItem.js";
import type { DiningProfileSnapshot } from "./diningProfileValidation.js";

export const ALLERGEN_CODES = [
  "GLUTEN", "DAIRY", "PEANUT", "TREE_NUTS", "SESAME", "SHELLFISH", "SOY", "EGGS", "FISH"
] as const;

const LEGACY_ALLERGEN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  NUTS: ["PEANUT", "TREE_NUTS"]
};

export function normalizeAllergen(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizeAllergenCodes(values: readonly string[] | undefined): string[] | undefined {
  if (values === undefined) return [];
  const normalized = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") return undefined;
    const code = normalizeAllergen(value);
    const expanded = LEGACY_ALLERGEN_ALIASES[code]
      ?? (ALLERGEN_CODES.includes(code as typeof ALLERGEN_CODES[number]) ? [code] : undefined);
    if (!expanded) return undefined;
    expanded.forEach((allergen) => normalized.add(allergen));
  }
  return ALLERGEN_CODES.filter((allergen) => normalized.has(allergen));
}

export function normalizeAllergenSet(values: string[] | undefined): Set<string> {
  return new Set(normalizeAllergenCodes(values) ?? []);
}

export function findAllergenConflicts(
  dishAllergens: string[] | undefined,
  userAllergies: string[] | undefined,
): string[] {
  const requested = normalizeAllergenSet(userAllergies);
  const dish = normalizeAllergenSet(dishAllergens);
  return ALLERGEN_CODES.filter((allergen) => dish.has(allergen) && requested.has(allergen));
}

export function isEligibleForAllergyAwareRecommendation(
  dish: Pick<IMenuItem, "nutritionComplete">,
  profile: Pick<IDishNutritionProfile, "isComplete"> | undefined,
  userProfile?: Pick<DiningProfileSnapshot, "allergies">,
): boolean {
  const allergies = userProfile?.allergies ?? [];
  if (allergies.length === 0) {
    return true;
  }

  if (dish.nutritionComplete === false || profile?.isComplete === false) {
    return false;
  }

  const complete = dish.nutritionComplete === true || profile?.isComplete === true;
  return complete;
}
