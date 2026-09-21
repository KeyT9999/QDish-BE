import assert from "node:assert/strict";
import mongoose from "mongoose";
import { RecommendationEngine } from "../engines/recommendation/RecommendationEngine.js";
import { FitScoreEngine } from "../engines/fitScore/FitScoreEngine.js";

const restaurantId = new mongoose.Types.ObjectId();
const dish = {
  _id: new mongoose.Types.ObjectId(),
  restaurantId,
  name: "Complete dish",
  description: "",
  price: 100,
  category: "Main course",
  imageUrl: "",
  available: true,
  ingredients: [],
  servingCount: 1,
  servingSizeGrams: 300,
  cookingMethod: "grilled",
  calories: 500,
  protein: 30,
  carbs: 40,
  fat: 10,
  fiber: 5,
  sugar: 3,
  sodium: 300,
  allergens: [] as string[],
  foodAttributes: ["HIGH_PROTEIN"] as string[],
  nutritionComplete: true,
};

async function recommendation(
  goals: string[],
  preferences: string[],
  allergies: string[] = [],
  menuItems = [dish],
) {
  return RecommendationEngine.generateRecommendations(
    restaurantId.toString(),
    { goals, preferences, allergies } as any,
    undefined,
    {
      async findMenuItems() {
        return menuItems as any;
      },
      async findNutritionProfiles() {
        return [] as any;
      },
    },
  );
}

assert.equal((await recommendation(["MUSCLE_GAIN"], [])).mode, "PERSONALIZED");
assert.equal((await recommendation(["MAINTENANCE"], [])).mode, "GENERAL");
assert.equal((await recommendation(["GENERAL_HEALTH"], [])).mode, "GENERAL");
assert.equal((await recommendation([], ["VEGAN"])).mode, "GENERAL");
assert.equal((await recommendation([], ["VEGAN", "HIGH_PROTEIN"])).mode, "GENERAL");
assert.equal((await recommendation(["MUSCLE_GAIN", "MAINTENANCE"], [])).mode, "PERSONALIZED");
assert.equal((await recommendation(["BALANCED"], ["VEGAN"])).mode, "PERSONALIZED");
assert.equal((await recommendation(["MAINTENANCE"], ["VEGAN"])).mode, "GENERAL");

const neutral = await recommendation([], []);
const veganOnly = await recommendation([], ["VEGAN"]);
assert.deepEqual(
  veganOnly.bestForYou.map((item) => [item.dish.name, item.fitScore]),
  neutral.bestForYou.map((item) => [item.dish.name, item.fitScore]),
);

const conflictingDish = { ...dish, _id: new mongoose.Types.ObjectId(), allergens: ["DAIRY"] };
const allergyResult = await recommendation(["MUSCLE_GAIN"], ["HIGH_PROTEIN"], ["DAIRY"], [conflictingDish]);
assert.equal(allergyResult.fullMenu.length, 0);

const incompleteDish = { ...dish, _id: new mongoose.Types.ObjectId(), nutritionComplete: false };
const incompleteResult = await recommendation(["MUSCLE_GAIN"], ["HIGH_PROTEIN"], [], [incompleteDish]);
assert.equal(incompleteResult.bestForYou.length, 0);
assert.equal(incompleteResult.fullMenu[0].isScoreReliable, false);

assert.equal(FitScoreEngine.resolvePrimaryScoreType({ goals: ["MUSCLE_GAIN", "BALANCED"], preferences: [], allergies: [] }), "gym_fit");
assert.equal(FitScoreEngine.resolvePrimaryScoreType({ goals: ["WEIGHT_LOSS", "ENERGY_BOOST"], preferences: [], allergies: [] }), "quick_lunch_fit");
assert.equal(FitScoreEngine.resolvePrimaryScoreType({ goals: ["MAINTENANCE"], preferences: [], allergies: [] }), undefined);
assert.equal(FitScoreEngine.resolvePrimaryScoreType({ goals: ["GENERAL_HEALTH"], preferences: [], allergies: [] }), undefined);

console.log("QAI-005 personalization mode tests passed");
