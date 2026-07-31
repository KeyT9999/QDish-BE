import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  BatchFitScoreDependencies,
  calculateBatchFitScores,
} from "../services/batchFitScoreService.js";

const restaurantAId = new mongoose.Types.ObjectId();
const restaurantBDishId = new mongoose.Types.ObjectId();
const restaurantADishId = new mongoose.Types.ObjectId();

let menuFindCalls = 0;
let profileFindCalls = 0;
let menuQuery: Parameters<BatchFitScoreDependencies["findMenuItems"]>[0] | undefined;
let profileQuery: Parameters<BatchFitScoreDependencies["findNutritionProfiles"]>[0] | undefined;

const dependencies: BatchFitScoreDependencies = {
  async findMenuItems(query) {
    menuFindCalls += 1;
    menuQuery = query;

    return [
      {
        _id: restaurantADishId,
        restaurantId: restaurantAId,
        available: true,
        calories: 450,
        protein: 35,
        carbs: 40,
        fat: 10,
        fiber: 4,
        sugar: 2,
        sodium: 400,
        allergens: [],
        foodAttributes: ["HIGH_PROTEIN", "LOW_SUGAR", "LOW_FAT"],
      },
      {
        _id: restaurantBDishId,
        restaurantId: new mongoose.Types.ObjectId(),
        available: true,
        calories: 900,
        protein: 1,
        carbs: 1,
        fat: 1,
        fiber: 0,
        sugar: 0,
        sodium: 0,
        allergens: [],
        foodAttributes: [],
      },
    ].filter((dish) => dish.restaurantId.equals(query.restaurantId));
  },
  async findNutritionProfiles(query) {
    profileFindCalls += 1;
    profileQuery = query;

    return [
      {
        dishId: restaurantADishId,
        restaurantId: restaurantAId,
        calories: 450,
        protein: 35,
        carb: 40,
        fat: 10,
        fiber: 4,
        sugar: 2,
        sodium: 400,
        attributes: ["HIGH_PROTEIN", "LOW_SUGAR", "LOW_FAT"],
        allergens: [],
        nutritionConfidence: 0.95,
      },
      {
        dishId: restaurantBDishId,
        restaurantId: new mongoose.Types.ObjectId(),
        calories: 900,
        protein: 1,
        carb: 1,
        fat: 1,
        fiber: 0,
        sugar: 0,
        sodium: 0,
        attributes: [],
        allergens: [],
        nutritionConfidence: 1,
      },
    ].filter(
      (profile) =>
        profile.restaurantId.equals(query.restaurantId) &&
        query.dishId.$in.some((dishId) => dishId.equals(profile.dishId))
    );
  },
};

const scores = await calculateBatchFitScores(
  {
    restaurantId: restaurantAId.toString(),
    userProfile: {
      goals: ["MUSCLE_GAIN"],
      allergies: [],
      preferences: ["HIGH_PROTEIN"],
    },
    context: { postWorkout: true },
  },
  dependencies
);

assert.equal(menuFindCalls, 1);
assert.equal(profileFindCalls, 1);
assert.ok(menuQuery?.restaurantId.equals(restaurantAId));
assert.equal(menuQuery?.available, true);
assert.ok(profileQuery?.restaurantId.equals(restaurantAId));
assert.deepEqual(profileQuery?.dishId.$in.map((id) => id.toString()), [restaurantADishId.toString()]);
assert.deepEqual(Object.keys(scores), [restaurantADishId.toString()]);
assert.equal(scores[restaurantADishId.toString()].contextType, "gym_fit");
assert.equal(scores[restaurantADishId.toString()].blocked, false);
assert.ok(scores[restaurantADishId.toString()].reasons.length <= 3);

const soyDishId = new mongoose.Types.ObjectId();
let allergenMenuFindCalls = 0;
let allergenProfileFindCalls = 0;
const allergenDependencies: BatchFitScoreDependencies = {
  async findMenuItems(query) {
    allergenMenuFindCalls += 1;
    assert.ok(query.restaurantId.equals(restaurantAId));
    assert.equal(query.available, true);
    return [
      {
        _id: soyDishId,
        restaurantId: restaurantAId,
        available: true,
        calories: 350,
        protein: 20,
        carbs: 20,
        fat: 12,
        fiber: 3,
        sugar: 2,
        sodium: 250,
        allergens: ["soy"],
        foodAttributes: ["HIGH_PROTEIN"],
      },
    ];
  },
  async findNutritionProfiles(query) {
    allergenProfileFindCalls += 1;
    assert.ok(query.restaurantId.equals(restaurantAId));
    assert.deepEqual(query.dishId.$in.map((id) => id.toString()), [soyDishId.toString()]);
    return [
      {
        dishId: soyDishId,
        restaurantId: restaurantAId,
        calories: 350,
        protein: 20,
        carb: 20,
        fat: 12,
        fiber: 3,
        sugar: 2,
        sodium: 250,
        attributes: ["HIGH_PROTEIN"],
        allergens: ["soy"],
        nutritionConfidence: 1,
      },
    ];
  },
};

const allergenScores = await calculateBatchFitScores(
  {
    restaurantId: restaurantAId.toString(),
    userProfile: {
      goals: ["MUSCLE_GAIN"],
      allergies: ["SOY"],
      preferences: [],
    },
  },
  allergenDependencies
);

assert.equal(allergenMenuFindCalls, 1);
assert.equal(allergenProfileFindCalls, 1);
assert.deepEqual(allergenScores[soyDishId.toString()], {
  score: 0,
  label: "Có dị ứng",
  contextType: "allergen_block",
  reasons: ["Món có thành phần xung đột với dị ứng đã chọn"],
  blocked: true,
  blockReason: "allergen",
});

console.log("Batch Fit Score service tests passed.");
