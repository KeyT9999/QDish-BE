import type { IDishNutritionProfile } from "../models/DishNutritionProfile.js";
import type { IMenuItem } from "../models/MenuItem.js";
import type { DiningProfileSnapshot } from "./diningProfileValidation.js";

export function normalizeAllergen(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizeAllergenSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map(normalizeAllergen).filter(Boolean));
}

export function findAllergenConflicts(
  dishAllergens: string[] | undefined,
  userAllergies: string[] | undefined,
): string[] {
  const requested = normalizeAllergenSet(userAllergies);
  return [...normalizeAllergenSet(dishAllergens)].filter((allergen) => requested.has(allergen));
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
