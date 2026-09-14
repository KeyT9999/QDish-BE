import type { ComputedNutrition } from "./nutritionService.js";
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
  foodAttributes?: string[];
  allergens?: string[];
}

export function serializeMenuItemForFeatures<T extends MenuItemResponseSource>(
  item: T,
  foodAttributesEnabled: boolean
) {
  return {
    ...item,
    id: item._id,
    nutrition: {
      calories: item.calories ?? 0,
      protein: item.protein ?? 0,
      carbs: item.carbs ?? 0,
      fat: item.fat ?? 0,
      fiber: item.fiber ?? 0,
      sugar: item.sugar ?? 0,
      sodium: item.sodium ?? 0,
      confidenceScore: item.confidenceScore ?? 0
    },
    foodAttributes: foodAttributesEnabled
      ? item.foodAttributes ?? []
      : [],
    allergens: item.allergens ?? []
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
    confidence: preview.nutritionConfidence
  };
}
