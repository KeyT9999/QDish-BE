import assert from "node:assert/strict";

import { MenuItem } from "../models/MenuItem.js";
import { DishNutritionProfile } from "../models/DishNutritionProfile.js";
import { NutritionService } from "../services/nutritionService.js";

const dish = {
  _id: "507f1f77bcf86cd799439011",
  ingredients: [],
  calories: 420,
  protein: 20,
  carbs: 50,
  fat: 12,
  fiber: 4,
  sugar: 8,
  sodium: 700,
  allergens: ["dairy"],
  foodAttributes: ["HIGH_PROTEIN"],
  confidenceScore: 100,
  save: async () => undefined
};

const originalFindById = MenuItem.findById;
const originalDeleteOne = DishNutritionProfile.deleteOne;
let deletedFilter: unknown;

(MenuItem.findById as any) = async () => dish;
(DishNutritionProfile.deleteOne as any) = async (filter: unknown) => {
  deletedFilter = filter;
  return { acknowledged: true, deletedCount: 1 };
};

try {
  await NutritionService.calculateDishNutrition(dish._id);

  assert.deepEqual(deletedFilter, { dishId: dish._id });
  assert.equal(dish.calories, 0);
  assert.equal(dish.protein, 0);
  assert.equal(dish.carbs, 0);
  assert.equal(dish.fat, 0);
  assert.equal(dish.fiber, 0);
  assert.equal(dish.sugar, 0);
  assert.equal(dish.sodium, 0);
  assert.deepEqual(dish.allergens, []);
  assert.deepEqual(dish.foodAttributes, []);
  assert.equal(dish.confidenceScore, 0);

  console.log("QAI-011 nutrition cache tests passed");
} finally {
  (MenuItem.findById as any) = originalFindById;
  (DishNutritionProfile.deleteOne as any) = originalDeleteOne;
}
