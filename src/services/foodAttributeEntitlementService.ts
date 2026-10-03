import type { ComputedNutrition } from "./nutritionService.js";
import { normalizeAllergenInfoStatus } from "./allergenInfoStatusPolicy.js";
import { normalizeAllergenCodes } from "./allergenSafetyService.js";
import { hasValidMenuAllergenReviewDeclaration } from "./menuAllergenReviewService.js";
import {
  getPlanLimits,
  resolveOwnerByRestaurant
} from "./subscriptionService.js";

interface FoodAttributeEntitlementDependencies {
  resolveOwnerByRestaurant: typeof resolveOwnerByRestaurant;
  getPlanLimits: typeof getPlanLimits;
}

const defaultDependencies: FoodAttributeEntitlementDependencies = {
  resolveOwnerByRestaurant,
  getPlanLimits
};

export async function isFoodAttributesEnabledForRestaurant(
  restaurantId: string,
  dependencies: FoodAttributeEntitlementDependencies = defaultDependencies
): Promise<boolean> {
  try {
    const ownerId = await dependencies.resolveOwnerByRestaurant(restaurantId);
    if (!ownerId) {
      return false;
    }

    const { plan } = await dependencies.getPlanLimits(ownerId);
    return plan?.foodAttributesEnabled === true;
  } catch (error) {
    console.error(
      "[FoodAttributeEntitlement] Failed to resolve plan; hiding premium attributes:",
      error
    );
    return false;
  }
}

interface MenuItemResponseSource {
  _id?: unknown;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  confidenceScore?: number;
  nutritionCompleteness?: number;
  nutritionComplete?: boolean;
  missingIngredientCount?: number;
  foodAttributes?: string[];
  allergens?: string[];
  allergenInfoStatus?: unknown;
  allergenCoverageStatus?: "UNKNOWN" | "INCOMPLETE" | "COMPLETE";
  allergenUnverifiedIngredientCount?: number;
  reviewedAllergens?: string[];
  mayContainAllergens?: string[];
  allergenReviewMethod?: string;
  allergenReviewSourceType?: string;
  allergenReviewSourceNote?: string;
  allergenReviewedBy?: unknown;
  allergenReviewedAt?: unknown;
}

export function serializeMenuItemForFeatures<T extends MenuItemResponseSource>(
  item: T,
  foodAttributesEnabled: boolean
) {
  const {
    allergenReviewMethod: _allergenReviewMethod,
    allergenReviewSourceType: _allergenReviewSourceType,
    allergenReviewSourceNote: _allergenReviewSourceNote,
    allergenReviewedBy: _allergenReviewedBy,
    allergenReviewedAt: _allergenReviewedAt,
    ...publicItem
  } = item;
  const reviewedAllergens = Array.isArray(item.reviewedAllergens)
    ? normalizeAllergenCodes(item.reviewedAllergens)
    : undefined;
  const mayContainAllergens = Array.isArray(item.mayContainAllergens)
    ? normalizeAllergenCodes(item.mayContainAllergens)
    : undefined;
  const declarationIsValid = hasValidMenuAllergenReviewDeclaration({
    method: item.allergenReviewMethod,
    sourceType: item.allergenReviewSourceType,
    sourceNote: item.allergenReviewSourceNote,
    reviewerId: item.allergenReviewedBy,
    reviewedAt: item.allergenReviewedAt,
    containsAllergens: item.reviewedAllergens,
    mayContainAllergens: item.mayContainAllergens
  });
  const infoStatus = normalizeAllergenInfoStatus(item.allergenInfoStatus) === "REVIEWED"
    && declarationIsValid
    ? "REVIEWED"
    : "UNKNOWN";
  return {
    ...publicItem,
    id: item._id,
    nutrition: {
      calories: item.calories ?? 0,
      protein: item.protein ?? 0,
      carbs: item.carbs ?? 0,
      fat: item.fat ?? 0,
      fiber: item.fiber ?? 0,
      sugar: item.sugar ?? 0,
      sodium: item.sodium ?? 0,
      confidenceScore: item.confidenceScore ?? 0,
      completeness: item.nutritionCompleteness ?? 0,
      isComplete: item.nutritionComplete ?? false,
      missingIngredientCount: item.missingIngredientCount ?? 0
    },
    foodAttributes: foodAttributesEnabled
      ? item.foodAttributes ?? []
      : [],
    allergens: item.allergens ?? [],
    allergenInfoStatus: infoStatus,
    allergenCoverageStatus: item.allergenCoverageStatus ?? "UNKNOWN",
    allergenUnverifiedIngredientCount: item.allergenUnverifiedIngredientCount ?? 0,
    reviewedAllergens: infoStatus === "REVIEWED" ? reviewedAllergens ?? [] : [],
    mayContainAllergens: infoStatus === "REVIEWED" ? mayContainAllergens ?? [] : []
  };
}

export function serializeNutritionPreviewForFeatures(
  preview: ComputedNutrition,
  servingCount: number,
  foodAttributesEnabled: boolean
) {
  return {
    perServing: {
      calories: preview.calories,
      protein: preview.protein,
      carbs: preview.carb,
      fat: preview.fat,
      fiber: preview.fiber,
      sugar: preview.sugar,
      sodium: preview.sodium
    },
    totalDish: {
      calories: Number((preview.calories * servingCount).toFixed(1)),
      protein: Number((preview.protein * servingCount).toFixed(1)),
      carbs: Number((preview.carb * servingCount).toFixed(1)),
      fat: Number((preview.fat * servingCount).toFixed(1)),
      fiber: Number((preview.fiber * servingCount).toFixed(1)),
      sugar: Number((preview.sugar * servingCount).toFixed(1)),
      sodium: Number((preview.sodium * servingCount).toFixed(1))
    },
    servingCount,
    attributes: foodAttributesEnabled ? preview.attributes : [],
    allergens: preview.allergens,
    confidence: preview.nutritionConfidence,
    completeness: preview.completeness ?? 0,
    isComplete: preview.isComplete ?? false,
    missingIngredientCount: preview.missingIngredientCount ?? 0
  };
}
