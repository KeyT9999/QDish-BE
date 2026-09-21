import mongoose, { Types } from "mongoose";
import { IIngredient } from "../models/Ingredient.js";
import { DishNutritionProfile, IDishNutritionProfile } from "../models/DishNutritionProfile.js";
import { MenuItem } from "../models/MenuItem.js";
import { repairDishNutritionProfileIndexes } from "./dishNutritionProfileIndexService.js";
import {
  assertIngredientsAccessible,
  resolveIngredientForRestaurant
} from "./ingredientAccessService.js";
import { normalizeAllergen } from "./allergenSafetyService.js";

export interface ComputedNutrition {
  calories: number;
  protein: number;
  carb: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
  attributes: string[];
  allergens: string[];
  nutritionConfidence: number;
  completeness?: number;
  isComplete?: boolean;
  missingIngredientCount?: number;
}

export class NutritionService {
  private static nutritionProfileIndexesRepaired = false;

  private static normalizeDishId(dishId: string | Types.ObjectId): Types.ObjectId {
    if (!dishId || !mongoose.Types.ObjectId.isValid(dishId)) {
      throw new Error("Valid dishId is required to calculate nutrition");
    }

    return typeof dishId === "string" ? new mongoose.Types.ObjectId(dishId) : dishId;
  }

  private static async ensureNutritionProfileIndexes(): Promise<void> {
    if (NutritionService.nutritionProfileIndexesRepaired) {
      return;
    }

    await repairDishNutritionProfileIndexes();
    NutritionService.nutritionProfileIndexesRepaired = true;
  }

  /**
   * Converts quantity and unit into absolute grams.
   */
  public static resolveGrams(quantity: number, unit: string, ingredient: IIngredient): number {
    const gramsPerUnit = ingredient.gramsPerUnit;
    switch (unit.toLowerCase()) {
      case "g":
        return quantity;
      case "ml":
        return quantity; // Assume 1:1 density for simple liquids
      case "piece":
        return quantity * (typeof gramsPerUnit === "number" && Number.isFinite(gramsPerUnit) && gramsPerUnit > 0 ? gramsPerUnit : 50); // Fallback to 50g
      case "tbsp":
        return quantity * 15;
      case "tsp":
        return quantity * 5;
      case "cup":
        return quantity * 200;
      case "bowl":
        return quantity * 350;
      default:
        return quantity;
    }
  }

  /**
   * Core math algorithm to calculate per-serving values from a list of recipe ingredients.
   * Does not perform DB writes (safe to use in preview endpoints).
   */
  public static async calculateNutrition(
    ingredientsInput: Array<{ ingredientId: string | Types.ObjectId; quantity: number; unit: string }>,
    servingCount: number,
    restaurantId?: string | Types.ObjectId | null
  ): Promise<ComputedNutrition> {
    const sc = servingCount > 0 ? servingCount : 1;

    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarb = 0;
    let totalFat = 0;
    let totalFiber = 0;
    let totalSugar = 0;
    let totalSodium = 0;
    let hasCompleteNutritionFacts = true;
    const allergenSet = new Set<string>();
    const resolvedIngredients: Array<{
      ingredientId: string;
      name: string;
      category: string;
      allergens: string[];
      attributes: string[];
    }> = [];

    for (const item of ingredientsInput) {
      const ingredient = await resolveIngredientForRestaurant(item.ingredientId, restaurantId);
      if (!ingredient) {
        continue;
      }

      const grams = this.resolveGrams(item.quantity, item.unit, ingredient);
      const scale = grams / 100;
      const nutritionFacts = [
        ingredient.caloriesPer100g,
        ingredient.proteinPer100g,
        ingredient.carbPer100g,
        ingredient.fatPer100g,
        ingredient.fiberPer100g,
        ingredient.sugarPer100g,
        ingredient.sodiumPer100g,
      ];
      if (!nutritionFacts.every((value) => typeof value === "number" && Number.isFinite(value))) {
        hasCompleteNutritionFacts = false;
      }

      totalCalories += (ingredient.caloriesPer100g ?? 0) * scale;
      totalProtein += (ingredient.proteinPer100g ?? 0) * scale;
      totalCarb += (ingredient.carbPer100g ?? 0) * scale;
      totalFat += (ingredient.fatPer100g ?? 0) * scale;
      totalFiber += (ingredient.fiberPer100g ?? 0) * scale;
      totalSugar += (ingredient.sugarPer100g ?? 0) * scale;
      totalSodium += (ingredient.sodiumPer100g ?? 0) * scale;

      if (ingredient.allergens && ingredient.allergens.length > 0) {
        ingredient.allergens.forEach((a) => {
          const normalized = normalizeAllergen(a);
          if (normalized) allergenSet.add(normalized);
        });
      }

      resolvedIngredients.push({
        ingredientId: ingredient._id.toString(),
        name: ingredient.name,
        category: ingredient.category,
        allergens: ingredient.allergens || [],
        attributes: ingredient.attributes || []
      });
    }

    // Per serving calculation
    const calories = Number((totalCalories / sc).toFixed(1));
    const protein = Number((totalProtein / sc).toFixed(1));
    const carb = Number((totalCarb / sc).toFixed(1));
    const fat = Number((totalFat / sc).toFixed(1));
    const fiber = Number((totalFiber / sc).toFixed(1));
    const sugar = Number((totalSugar / sc).toFixed(1));
    const sodium = Number((totalSodium / sc).toFixed(1));

    // Macro consistency validation check
    const calcKcal = (protein * 4) + (carb * 4) + (fat * 9);
    const discrepancy = calories > 0 ? Math.abs(calcKcal - calories) / calories : 0;
    const resolvedIngredientCount = resolvedIngredients.length;
    const requestedIngredientCount = ingredientsInput.length;
    const missingIngredientCount = requestedIngredientCount - resolvedIngredientCount;
    const completeness = requestedIngredientCount > 0
      ? Number((resolvedIngredientCount / requestedIngredientCount).toFixed(2))
      : 0;
    const isComplete = requestedIngredientCount > 0 && missingIngredientCount === 0 && hasCompleteNutritionFacts;
    const nutritionConfidence = calories > 0 ? Number(Math.max(0, 1 - discrepancy).toFixed(2)) : 0;

    const draftNutrition: ComputedNutrition = {
      calories,
      protein,
      carb,
      fat,
      fiber,
      sugar,
      sodium,
      attributes: [],
      allergens: Array.from(allergenSet),
      nutritionConfidence,
      completeness,
      isComplete,
      missingIngredientCount
    };

    // Calculate food attributes using the enhanced AttributeEngine
    const { AttributeEngine } = await import("../engines/attributes/AttributeEngine.js");
    draftNutrition.attributes = AttributeEngine.applyAllRules(draftNutrition, {
      servingCount: sc,
      ingredients: resolvedIngredients
    });

    return draftNutrition;
  }

  /**
   * Synchronously recalculates nutrition details for a specific dish
   * and caches the result in both DishNutritionProfile and MenuItem.
   */
  public static async calculateDishNutrition(dishId: string | Types.ObjectId): Promise<IDishNutritionProfile | null> {
    const normalizedDishId = this.normalizeDishId(dishId);

    const dish = await MenuItem.findById(normalizedDishId);
    if (!dish) {
      return null;
    }

    // An explicit empty recipe clears all derived nutrition and allergen data.
    if (!dish.ingredients || dish.ingredients.length === 0) {
      await DishNutritionProfile.deleteOne({ dishId: dish._id });
      dish.calories = 0;
      dish.protein = 0;
      dish.carbs = 0;
      dish.fat = 0;
      dish.fiber = 0;
      dish.sugar = 0;
      dish.sodium = 0;
      dish.allergens = [];
      dish.foodAttributes = [];
      dish.confidenceScore = 0;
      dish.nutritionCompleteness = 0;
      dish.nutritionComplete = false;
      dish.missingIngredientCount = 0;
      await dish.save();
      return null;
    }

    await assertIngredientsAccessible(dish.ingredients, dish.restaurantId);

    await NutritionService.ensureNutritionProfileIndexes();

    // Resolve resolved grams for the embedded list
    const updatedIngredients = [];
    for (const item of dish.ingredients) {
      const ingredient = await resolveIngredientForRestaurant(item.ingredientId, dish.restaurantId);
      let grams = item.quantity;
      if (ingredient) {
        grams = this.resolveGrams(item.quantity, item.unit, ingredient);
      }
      updatedIngredients.push({
        ingredientId: item.ingredientId,
        quantity: item.quantity,
        unit: item.unit,
        gramsResolved: grams
      });
    }

    // Mutate dish ingredients array with resolved grams
    dish.ingredients = updatedIngredients as any;

    const computed = await this.calculateNutrition(dish.ingredients, dish.servingCount, dish.restaurantId);

    // Compute fit scores and best fit context for the dish
    const { FitScoreEngine } = await import("../engines/fitScore/FitScoreEngine.js");
    const fitScores = FitScoreEngine.calculateAllFitScores(computed, computed.attributes);
    const bestFit = FitScoreEngine.getBestFitContext(fitScores);

    // Upsert into DishNutritionProfile
    const profile = await DishNutritionProfile.findOneAndUpdate(
      { dishId: dish._id },
      {
        dishId: dish._id,
        restaurantId: dish.restaurantId,
        calories: computed.calories,
        protein: computed.protein,
        carb: computed.carb,
        fat: computed.fat,
        fiber: computed.fiber,
        sugar: computed.sugar,
        sodium: computed.sodium,
        attributes: computed.attributes,
        allergens: computed.allergens,
        nutritionConfidence: computed.nutritionConfidence,
        completeness: computed.completeness,
        isComplete: computed.isComplete,
        missingIngredientCount: computed.missingIngredientCount,
        fitScores,
        bestFitContext: bestFit.type,
        calculatedAt: new Date()
      },
      { new: true, upsert: true }
    );

    // Sync values back to MenuItem for legacy query backward compatibility
    dish.calories = computed.calories;
    dish.protein = computed.protein;
    dish.carbs = computed.carb; // maps carb to carbs field in MenuItem schema
    dish.fat = computed.fat;
    dish.fiber = computed.fiber;
    dish.sugar = computed.sugar;
    dish.sodium = computed.sodium;
    dish.allergens = computed.allergens;
    dish.foodAttributes = computed.attributes;
    dish.confidenceScore = Math.round(computed.nutritionConfidence * 100);
    dish.nutritionCompleteness = computed.completeness;
    dish.nutritionComplete = computed.isComplete;
    dish.missingIngredientCount = computed.missingIngredientCount;
    
    await dish.save();

    return profile;
  }
}
