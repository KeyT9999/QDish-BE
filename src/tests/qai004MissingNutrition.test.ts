import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  RecommendationEngine,
} from "../engines/recommendation/RecommendationEngine.js";
import { calculateBatchFitScores } from "../services/batchFitScoreService.js";

const restaurantId = new mongoose.Types.ObjectId();

function dish(name: string, nutritionComplete?: boolean) {
  return {
    _id: new mongoose.Types.ObjectId(),
    restaurantId,
    name,
    description: "",
    price: 100,
    category: "Main course",
    imageUrl: "",
    available: true,
    ingredients: [],
    servingCount: 1,
    servingSizeGrams: 300,
    cookingMethod: "grilled",
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    sugar: 0,
    sodium: 0,
    allergens: [],
    foodAttributes: [],
    ...(nutritionComplete === undefined ? {} : { nutritionComplete }),
  };
}

const complete = dish("Complete low score", true);
const legacy = dish("Legacy unknown");
const incomplete = dish("Incomplete", false);
const zeroCompleteness = dish("Zero completeness", true);
(zeroCompleteness as any).nutritionCompleteness = 0;

const recommendation = await RecommendationEngine.generateRecommendations(
  restaurantId.toString(),
  { goals: ["BUILD_MUSCLE"], preferences: [], allergies: [] } as any,
  undefined,
  {
    async findMenuItems() {
      return [complete, legacy, incomplete, zeroCompleteness] as any;
    },
    async findNutritionProfiles() {
      return [] as any;
    },
  },
);

assert.ok(recommendation.bestForYou.some((item) => item.dish.name === complete.name));
assert.equal(recommendation.bestForYou.some((item) => item.dish.name === legacy.name), false);
assert.equal(recommendation.bestForYou.some((item) => item.dish.name === incomplete.name), false);
assert.equal(recommendation.fullMenu.length, 4);
for (const name of [legacy.name, incomplete.name, zeroCompleteness.name]) {
  const entry = recommendation.fullMenu.find((item) => item.dish.name === name);
  assert.ok(entry);
  assert.equal((entry as any).fitScore, 0);
  assert.equal((entry as any).isScoreReliable, false);
  assert.equal((entry as any).bestContext, "nutrition_incomplete");
}

const batchDish = dish("Batch legacy");
const batch = await calculateBatchFitScores(
  {
    restaurantId: restaurantId.toString(),
    userProfile: { goals: ["BUILD_MUSCLE"], preferences: [], allergies: [] } as any,
  },
  {
    async findMenuItems() {
      return [batchDish] as any;
    },
    async findNutritionProfiles() {
      return [] as any;
    },
  },
);
assert.equal(batch[batchDish._id.toString()].isScoreReliable, false);
assert.equal(batch[batchDish._id.toString()].score, 0);

console.log("QAI-004 missing nutrition regression tests passed");
