import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  RecommendationEngine,
  type RecommendationEngineDependencies,
} from "../engines/recommendation/RecommendationEngine.js";

const restaurantId = new mongoose.Types.ObjectId();

function makeDish(name: string, category: string, allergens: string[] = []) {
  return {
    _id: new mongoose.Types.ObjectId(),
    restaurantId,
    name,
    description: "",
    price: 50000,
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
  };
}

const safeMain = makeDish("Safe main", "Main course");
const menuNutDish = makeDish("Nut dish", "Main course", ["NuTs"]);
const cachedDairySide = makeDish("Cached dairy side", "Salad");
const cachedDairyProfile = {
  dishId: cachedDairySide._id,
  restaurantId,
  calories: 200,
  protein: 8,
  carb: 12,
  fat: 8,
  fiber: 4,
  sugar: 3,
  sodium: 180,
  attributes: ["LIGHT_MEAL"],
  allergens: ["DAIRY"],
  nutritionConfidence: 0.9,
};

const dependencies: RecommendationEngineDependencies = {
  async findMenuItems() {
    return [safeMain, menuNutDish, cachedDairySide] as any;
  },
  async findNutritionProfiles() {
    return [cachedDairyProfile] as any;
  },
};

const general = await RecommendationEngine.generateRecommendations(
  restaurantId.toString(),
  undefined,
  { timeOfDay: "dinner" },
  dependencies,
);
assert.equal(general.mode, "GENERAL");
assert.equal(general.emptyReason, undefined);
assert.deepEqual(Object.keys(general).sort(), [
  "bestForYou",
  "fullMenu",
  "mode",
  "pairingSuggestions",
]);
assert.deepEqual(Object.keys(general.fullMenu[0]).sort(), [
  "allergenWarnings",
  "bestContext",
  "bestContextLabel",
  "dish",
  "fitScore",
]);
assert.deepEqual(Object.keys(general.bestForYou[0]).sort(), [
  "allergenWarnings",
  "bestContext",
  "bestContextLabel",
  "dish",
  "fitScore",
  "reason",
]);
assert.equal(general.bestForYou.some(({ reason }) => reason.includes("của bạn")), false);

const personalized = await RecommendationEngine.generateRecommendations(
  restaurantId.toString(),
  { goals: ["BALANCED"], preferences: [], allergies: [] },
  undefined,
  dependencies,
);
assert.equal(personalized.mode, "PERSONALIZED");

const preferenceOnly = await RecommendationEngine.generateRecommendations(
  restaurantId.toString(),
  { goals: [], preferences: ["HIGH_PROTEIN"], allergies: [] },
  undefined,
  dependencies,
);
assert.equal(preferenceOnly.mode, "PERSONALIZED");
assert.ok(preferenceOnly.bestForYou.every(({ fitScore }) => fitScore > 0));

const allergiesOnly = await RecommendationEngine.generateRecommendations(
  restaurantId.toString(),
  { goals: [], preferences: [], allergies: ["dairy", "NUTS"] },
  undefined,
  dependencies,
);
assert.equal(allergiesOnly.mode, "GENERAL");
assert.equal(allergiesOnly.fullMenu.some(({ dish }) => dish.name === "Nut dish"), false);
assert.equal(allergiesOnly.fullMenu.some(({ dish }) => dish.name === "Cached dairy side"), false);
assert.equal(allergiesOnly.pairingSuggestions.some(({ pairedDish }) => pairedDish.name === "Cached dairy side"), false);
assert.equal(allergiesOnly.bestForYou.some(({ dish }) => dish.name !== "Safe main"), false);

const noMenuDependencies: RecommendationEngineDependencies = {
  async findMenuItems() {
    return [];
  },
  async findNutritionProfiles() {
    throw new Error("Nutrition profiles should not be read for an empty menu");
  },
};
const noMenu = await RecommendationEngine.generateRecommendations(
  restaurantId.toString(),
  undefined,
  undefined,
  noMenuDependencies,
);
assert.equal(noMenu.emptyReason, "NO_AVAILABLE_DISHES");
assert.deepEqual(noMenu.bestForYou, []);
assert.deepEqual(noMenu.fullMenu, []);
assert.deepEqual(noMenu.pairingSuggestions, []);

const onlyAllergenicDish = makeDish("Only dairy", "Salad", ["dAiRy"]);
const noSafeMenuDependencies: RecommendationEngineDependencies = {
  async findMenuItems() {
    return [onlyAllergenicDish] as any;
  },
  async findNutritionProfiles() {
    return [];
  },
};
const noSafeMenu = await RecommendationEngine.generateRecommendations(
  restaurantId.toString(),
  { goals: [], preferences: [], allergies: ["DAIRY"] },
  undefined,
  noSafeMenuDependencies,
);
assert.equal(noSafeMenu.emptyReason, "NO_ALLERGEN_SAFE_DISHES");
assert.deepEqual(noSafeMenu.bestForYou, []);
assert.deepEqual(noSafeMenu.fullMenu, []);
assert.deepEqual(noSafeMenu.pairingSuggestions, []);

console.log("Recommendation engine policy tests passed.");
