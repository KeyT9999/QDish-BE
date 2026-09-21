import assert from "node:assert/strict";
import mongoose from "mongoose";
import { FitScoreEngine } from "../engines/fitScore/FitScoreEngine.js";
import { RecommendationEngine } from "../engines/recommendation/RecommendationEngine.js";

const nutrition = {
  calories: 450,
  protein: 30,
  carb: 40,
  fat: 10,
  fiber: 5,
  sugar: 3,
  sodium: 300,
  attributes: ["HIGH_PROTEIN"],
  allergens: [],
  nutritionConfidence: 1,
};

assert.notEqual(
  FitScoreEngine.calculateFitScore(nutrition, nutrition.attributes, "quick_lunch_fit", undefined, { timeOfDay: "lunch" }).score,
  FitScoreEngine.calculateFitScore(nutrition, nutrition.attributes, "quick_lunch_fit").score,
);
assert.equal(
  FitScoreEngine.getContextMultiplier("late_night_fit", { timeOfDay: "late_night", weather: "rainy" }),
  1.32,
);

for (const context of [
  { timeOfDay: "breakfast" as const },
  { timeOfDay: "dinner" as const },
  { weather: "hot" as const },
  { weather: "cold" as const },
  { occasion: "casual" },
  { occasion: "date" },
  { occasion: "family" },
]) {
  assert.equal(
    FitScoreEngine.calculateFitScore(nutrition, nutrition.attributes, "quick_lunch_fit", undefined, context).score,
    FitScoreEngine.calculateFitScore(nutrition, nutrition.attributes, "quick_lunch_fit").score,
  );
}

const restaurantId = new mongoose.Types.ObjectId();
const dish = {
  _id: new mongoose.Types.ObjectId(), restaurantId, name: "Complete dish", description: "", price: 100,
  category: "Main course", imageUrl: "", available: true, ingredients: [], servingCount: 1,
  servingSizeGrams: 300, cookingMethod: "grilled", calories: 450, protein: 30, carbs: 40,
  fat: 10, fiber: 5, sugar: 3, sodium: 300, allergens: [] as string[],
  foodAttributes: ["HIGH_PROTEIN"] as string[], nutritionComplete: true,
};

const breakfastRecommendation = await RecommendationEngine.generateRecommendations(
  restaurantId.toString(), undefined, { timeOfDay: "breakfast" }, {
    async findMenuItems() { return [dish] as any; },
    async findNutritionProfiles() { return [] as any; },
  },
);
assert.doesNotMatch(breakfastRecommendation.bestForYou[0].reason, /breakfast/);

console.log("QAI-015 context semantics tests passed");
