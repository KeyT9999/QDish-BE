import assert from "node:assert/strict";
import mongoose from "mongoose";

import { RecommendationEngine, type RecommendationEngineDependencies } from "../engines/recommendation/RecommendationEngine.js";

const restaurantId = new mongoose.Types.ObjectId();

function dish(name: string, allergens: string[] = [], nutritionComplete = true, category = "Main course") {
  return {
    _id: new mongoose.Types.ObjectId(),
    restaurantId,
    name,
    description: "",
    price: 100,
    category,
    imageUrl: "",
    available: true,
    ingredients: [],
    servingCount: 1,
    servingSizeGrams: 300,
    cookingMethod: "grilled",
    calories: 480,
    protein: 30,
    carbs: 40,
    fat: 12,
    fiber: 5,
    sugar: 3,
    sodium: 400,
    allergens,
    foodAttributes: ["HIGH_PROTEIN", "LIGHT_MEAL"],
    nutritionComplete,
  };
}

const safeMain = dish("Safe main");
const dairyDish = dish("Dairy dish", [" Dairy ", "dairy"]);
const incompleteSide = dish("Incomplete side", [], false, "Salad");
const safeSide = dish("Safe side", [], true, "Salad");

const dependencies: RecommendationEngineDependencies = {
  async findMenuItems() {
    return [safeMain, dairyDish, incompleteSide, safeSide] as any;
  },
  async findNutritionProfiles() {
    return [];
  },
};

const allergies = { goals: [], preferences: [], allergies: ["DAIRY", " gluten "] };
const result = await RecommendationEngine.generateRecommendations(
  restaurantId.toString(),
  allergies,
  undefined,
  dependencies,
);

assert.equal(result.fullMenu.some(({ dish: item }) => item.name === "Dairy dish"), false);
assert.equal(result.fullMenu.some(({ dish: item }) => item.name === "Incomplete side"), false);
assert.equal(result.pairingSuggestions.some(({ pairedDish }) => pairedDish.name === "Dairy dish"), false);
assert.equal(result.pairingSuggestions.some(({ pairedDish }) => pairedDish.name === "Incomplete side"), false);
assert.ok(result.pairingSuggestions.every(({ pairedDish }) => (
  pairedDish.name !== "Dairy dish" && pairedDish.name !== "Incomplete side"
)));

const noAllergies = await RecommendationEngine.generateRecommendations(
  restaurantId.toString(),
  { goals: [], preferences: [], allergies: [] },
  undefined,
  dependencies,
);
assert.equal(noAllergies.fullMenu.some(({ dish: item }) => item.name === "Incomplete side"), true);

console.log("QAI-001 allergy safety tests passed");
