import mongoose, { Types } from "mongoose";
import { DishNutritionProfile } from "../models/DishNutritionProfile.js";
import { MenuItem } from "../models/MenuItem.js";
import { NutritionService } from "./nutritionService.js";

export interface IngredientMenuImpact {
  affectedMenuItemIds: string[];
  recomputedCount: number;
  failedMenuItemIds: string[];
}

export async function invalidateDependentMenuReviews(
  ingredientId: string | Types.ObjectId,
  restaurantId?: string | Types.ObjectId | null
): Promise<string[]> {
  const filter: Record<string, unknown> = { "ingredients.ingredientId": ingredientId };
  if (restaurantId) filter.restaurantId = restaurantId;
  const menuItems = await MenuItem.find(filter).select("_id").lean();
  const ids = menuItems.map((item) => new mongoose.Types.ObjectId(String(item._id)));
  if (ids.length === 0) return [];

  await MenuItem.updateMany(
    { _id: { $in: ids }, ...(restaurantId ? { restaurantId } : {}) },
    {
      $set: {
        allergens: [],
        allergenInfoStatus: "UNKNOWN",
        allergenCoverageStatus: "UNKNOWN",
        allergenUnverifiedIngredientCount: 0,
        reviewedAllergens: [],
        mayContainAllergens: [],
        allergenReviewMethod: null,
        allergenReviewSourceType: null,
        allergenReviewSourceNote: null,
        allergenReviewedBy: null,
        allergenReviewedAt: null
      }
    }
  );
  await DishNutritionProfile.updateMany(
    { dishId: { $in: ids }, ...(restaurantId ? { restaurantId } : {}) },
    { $set: { allergens: [], allergenCoverageStatus: "UNKNOWN", allergenUnverifiedIngredientCount: 0 } }
  );
  return ids.map(String);
}

export async function recomputeDependentMenuAllergens(
  menuItemIds: readonly string[],
  batchSize = 20
): Promise<IngredientMenuImpact> {
  const failedMenuItemIds: string[] = [];
  let recomputedCount = 0;
  for (let offset = 0; offset < menuItemIds.length; offset += batchSize) {
    const batch = menuItemIds.slice(offset, offset + batchSize);
    const results = await Promise.allSettled(batch.map((id) => NutritionService.calculateDishNutrition(id)));
    results.forEach((result, index) => {
      if (result.status === "fulfilled") recomputedCount += 1;
      else failedMenuItemIds.push(batch[index]);
    });
  }
  return { affectedMenuItemIds: [...menuItemIds], recomputedCount, failedMenuItemIds };
}
