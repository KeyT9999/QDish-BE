import assert from "node:assert/strict";
import mongoose from "mongoose";
import { AttributeEngine } from "../engines/attributes/AttributeEngine.js";
import { calculateBatchFitScores } from "../services/batchFitScoreService.js";

const baseNutrition = {
  calories: 400,
  protein: 25,
  carb: 30,
  fat: 10,
  fiber: 6,
  sugar: 5,
  sodium: 100,
  attributes: [],
  allergens: [],
  nutritionConfidence: 1,
  completeness: 1,
  isComplete: true,
  missingIngredientCount: 0,
};
const context = { servingCount: 1, ingredients: [] };

function attributesFor(overrides: Partial<typeof baseNutrition>) {
  return AttributeEngine.applyAllRules({ ...baseNutrition, ...overrides }, context);
}

assert.equal(attributesFor({ protein: 24.9 }).includes("HIGH_PROTEIN"), false);
assert.equal(attributesFor({ protein: 25 }).includes("HIGH_PROTEIN"), true);
assert.equal(attributesFor({ protein: 25.1 }).includes("HIGH_PROTEIN"), true);
assert.equal(attributesFor({ fiber: 5.9 }).includes("HIGH_FIBER"), false);
assert.equal(attributesFor({ fiber: 6 }).includes("HIGH_FIBER"), true);
assert.equal(attributesFor({ fiber: 6.1 }).includes("HIGH_FIBER"), true);
assert.equal(attributesFor({ sugar: 0 }).includes("LOW_SUGAR"), true);
assert.equal(attributesFor({ sugar: 5 }).includes("LOW_SUGAR"), true);
assert.equal(attributesFor({ sugar: 5.1 }).includes("LOW_SUGAR"), false);
assert.equal(attributesFor({ sugar: 0, completeness: 0, isComplete: false }).includes("LOW_SUGAR"), false);
assert.equal(attributesFor({ calories: 0 }).includes("LOW_CALORIE"), false);
assert.equal(attributesFor({ calories: 399.9 }).includes("LOW_CALORIE"), true);
assert.equal(attributesFor({ calories: 400 }).includes("LOW_CALORIE"), true);
assert.equal(attributesFor({ calories: 400.1 }).includes("LOW_CALORIE"), false);

const restaurantId = new mongoose.Types.ObjectId();
const dishId = new mongoose.Types.ObjectId();
const scores = await calculateBatchFitScores(
  { restaurantId: restaurantId.toString(), userProfile: { goals: [], preferences: [], allergies: [] } },
  {
    async findMenuItems() {
      return [{ _id: dishId, restaurantId, available: true, foodAttributes: [], nutritionComplete: true }] as any;
    },
    async findNutritionProfiles() {
      return [{ dishId, restaurantId, ...baseNutrition, attributes: [] }] as any;
    },
  },
);
assert.equal(scores[dishId.toString()].reasons.some((reason) => reason.includes("Giàu đạm")), false);
assert.equal(scores[dishId.toString()].reasons.some((reason) => reason.includes("Giàu chất xơ")), false);

console.log("QAI-018 backend attribute consistency tests passed");
