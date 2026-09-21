import assert from "node:assert/strict";

import { Ingredient } from "../models/Ingredient.js";
import { NutritionService } from "../services/nutritionService.js";

const restaurantA = "507f1f77bcf86cd799439011";
const foreignIngredient = {
  _id: "507f1f77bcf86cd799439021",
  name: "Foreign custom sauce",
  category: "sauces",
  restaurantId: "507f1f77bcf86cd799439012",
  isVerified: false,
  gramsPerUnit: 1,
  caloriesPer100g: 100,
  proteinPer100g: 1,
  carbPer100g: 10,
  fatPer100g: 2,
  fiberPer100g: 0,
  sugarPer100g: 1,
  sodiumPer100g: 10,
  allergens: []
};

const globalIngredient = {
  ...foreignIngredient,
  _id: "507f1f77bcf86cd799439022",
  restaurantId: null,
  isVerified: true
};

const ownIngredient = {
  ...foreignIngredient,
  _id: "507f1f77bcf86cd799439023",
  restaurantId: restaurantA
};

async function testForeignIngredientCannotBeResolvedForNutrition() {
  const originalFindById = Ingredient.findById;
  (Ingredient.findById as any) = async () => foreignIngredient;

  try {
    await assert.rejects(
      () => (NutritionService.calculateNutrition as any)(
        [{ ingredientId: foreignIngredient._id, quantity: 10, unit: "g" }],
        1,
        restaurantA
      ),
      /not accessible/i
    );
  } finally {
    (Ingredient.findById as any) = originalFindById;
  }
}

async function testGlobalAndOwnIngredientsRemainResolvable() {
  const originalFindById = Ingredient.findById;
  (Ingredient.findById as any) = async (ingredientId: string) => {
    if (ingredientId === globalIngredient._id) return globalIngredient;
    return ownIngredient;
  };

  try {
    const globalResult = await (NutritionService.calculateNutrition as any)(
      [{ ingredientId: globalIngredient._id, quantity: 10, unit: "g" }],
      1,
      restaurantA
    );
    assert.equal(globalResult.calories, 10);

    const ownResult = await (NutritionService.calculateNutrition as any)(
      [{ ingredientId: ownIngredient._id, quantity: 10, unit: "g" }],
      1,
      restaurantA
    );
    assert.equal(ownResult.calories, 10);
  } finally {
    (Ingredient.findById as any) = originalFindById;
  }
}

testGlobalAndOwnIngredientsRemainResolvable()
  .then(testForeignIngredientCannotBeResolvedForNutrition)
  .then(() => console.log("QAI-003 nutrition isolation tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
