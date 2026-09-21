import assert from "node:assert/strict";

import { Ingredient } from "../models/Ingredient.js";
import { NutritionService } from "../services/nutritionService.js";

const restaurantId = "507f1f77bcf86cd799439011";
const knownA = {
  _id: "507f1f77bcf86cd799439021",
  name: "Known A",
  category: "test",
  restaurantId,
  isVerified: false,
  gramsPerUnit: 1,
  caloriesPer100g: 200,
  proteinPer100g: 20,
  carbPer100g: 0,
  fatPer100g: 0,
  fiberPer100g: 0,
  sugarPer100g: 0,
  sodiumPer100g: 0,
  allergens: []
};
const knownB = { ...knownA, _id: "507f1f77bcf86cd799439022", name: "Known B" };

const originalFindById = Ingredient.findById;
(Ingredient.findById as any) = async (ingredientId: string) => {
  if (ingredientId === knownA._id) return knownA;
  if (ingredientId === knownB._id) return knownB;
  return null;
};

try {
  const complete = await NutritionService.calculateNutrition([
    { ingredientId: knownA._id, quantity: 50, unit: "g" },
    { ingredientId: knownB._id, quantity: 50, unit: "g" },
    { ingredientId: knownA._id, quantity: 10, unit: "g" }
  ], 1, restaurantId);
  assert.equal(complete.isComplete, true);
  assert.equal(complete.missingIngredientCount, 0);
  assert.equal(complete.completeness, 1);

  const partial = await NutritionService.calculateNutrition([
    { ingredientId: knownA._id, quantity: 50, unit: "g" },
    { ingredientId: "507f1f77bcf86cd799439031", quantity: 50, unit: "g" },
    { ingredientId: knownB._id, quantity: 50, unit: "g" },
    { ingredientId: "507f1f77bcf86cd799439032", quantity: 50, unit: "g" },
    { ingredientId: knownA._id, quantity: 50, unit: "g" }
  ], 1, restaurantId);
  assert.equal(partial.isComplete, false);
  assert.equal(partial.missingIngredientCount, 2);
  assert.equal(partial.completeness, 0.6);
  assert.equal(partial.calories, 300);

  const allMissing = await NutritionService.calculateNutrition([
    { ingredientId: "507f1f77bcf86cd799439041", quantity: 50, unit: "g" },
    { ingredientId: "507f1f77bcf86cd799439042", quantity: 50, unit: "g" },
    { ingredientId: "507f1f77bcf86cd799439043", quantity: 50, unit: "g" }
  ], 1, restaurantId);
  assert.equal(allMissing.isComplete, false);
  assert.equal(allMissing.missingIngredientCount, 3);
  assert.equal(allMissing.completeness, 0);
  assert.equal(allMissing.nutritionConfidence, 0);

  const empty = await NutritionService.calculateNutrition([], 1, restaurantId);
  assert.equal(empty.isComplete, false);
  assert.equal(empty.missingIngredientCount, 0);
  assert.equal(empty.completeness, 0);

  console.log("QAI-008 nutrition completeness tests passed");
} finally {
  (Ingredient.findById as any) = originalFindById;
}
