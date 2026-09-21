import mongoose, { Types } from "mongoose";
import { Ingredient, IIngredient } from "../models/Ingredient.js";

export type IngredientTenantId = string | Types.ObjectId | null | undefined;

export class IngredientAccessDeniedError extends Error {
  constructor() {
    super("Ingredient is not accessible for this restaurant");
    this.name = "IngredientAccessDeniedError";
  }
}

export function buildIngredientAccessFilter(restaurantId: IngredientTenantId) {
  if (restaurantId && mongoose.isValidObjectId(restaurantId)) {
    return {
      $or: [
        { isVerified: true },
        { restaurantId: new mongoose.Types.ObjectId(restaurantId) }
      ]
    };
  }

  return { isVerified: true };
}

export function isIngredientAccessible(
  ingredient: Pick<IIngredient, "isVerified" | "restaurantId">,
  restaurantId: IngredientTenantId
): boolean {
  if (ingredient.isVerified) {
    return true;
  }

  return Boolean(
    restaurantId &&
    mongoose.isValidObjectId(restaurantId) &&
    ingredient.restaurantId?.toString() === restaurantId.toString()
  );
}

export async function resolveIngredientForRestaurant(
  ingredientId: string | Types.ObjectId,
  restaurantId: IngredientTenantId
): Promise<IIngredient | null> {
  const ingredient = await Ingredient.findById(ingredientId);
  if (!ingredient) {
    return null;
  }

  if (!isIngredientAccessible(ingredient, restaurantId)) {
    throw new IngredientAccessDeniedError();
  }

  return ingredient;
}

export async function assertIngredientsAccessible(
  ingredientRows: Array<{ ingredientId: string | Types.ObjectId }>,
  restaurantId: IngredientTenantId
): Promise<void> {
  if (ingredientRows.length === 0) {
    return;
  }

  const ingredientIds = ingredientRows.map((row) => row.ingredientId);
  const ingredients = await Ingredient.find({ _id: { $in: ingredientIds } }).lean();

  for (const ingredient of ingredients) {
    if (!isIngredientAccessible(ingredient, restaurantId)) {
      throw new IngredientAccessDeniedError();
    }
  }
}

