import assert from "node:assert/strict";

import {
  isFoodAttributesEnabledForRestaurant,
  serializeMenuItemForFeatures,
  serializeNutritionPreviewForFeatures
} from "../services/foodAttributeEntitlementService.js";

const menuItem = {
  _id: "dish-1",
  name: "Chicken Bowl",
  calories: 420,
  protein: 32,
  carbs: 40,
  fat: 12,
  fiber: 6,
  sugar: 4,
  sodium: 550,
  confidenceScore: 92,
  foodAttributes: ["HIGH_PROTEIN", "POST_WORKOUT"],
  allergens: ["SOY"]
};

const nutritionPreview = {
  calories: 420,
  protein: 32,
  carb: 40,
  fat: 12,
  fiber: 6,
  sugar: 4,
  sodium: 550,
  attributes: ["HIGH_PROTEIN", "POST_WORKOUT"],
  allergens: ["SOY"],
  nutritionConfidence: 0.92
};

function testFreeMenuResponseHidesOnlyFoodAttributes() {
  const response = serializeMenuItemForFeatures(menuItem, false);

  assert.deepEqual(response.foodAttributes, []);
  assert.deepEqual(response.allergens, ["SOY"]);
  assert.equal(response.nutrition.calories, 420);
  assert.equal(response.nutrition.protein, 32);
}

function testPlusMenuResponseIncludesFoodAttributes() {
  const response = serializeMenuItemForFeatures(menuItem, true);

  assert.deepEqual(response.foodAttributes, ["HIGH_PROTEIN", "POST_WORKOUT"]);
  assert.deepEqual(response.allergens, ["SOY"]);
}

function testFreePreviewHidesOnlyFoodAttributes() {
  const response = serializeNutritionPreviewForFeatures(
    nutritionPreview,
    2,
    false
  );

  assert.deepEqual(response.attributes, []);
  assert.deepEqual(response.allergens, ["SOY"]);
  assert.equal(response.perServing.calories, 420);
  assert.equal(response.totalDish.calories, 840);
}

async function testEntitlementRequiresAnExplicitEnabledFlag() {
  const baseDependencies = {
    resolveOwnerByRestaurant: async () => "owner-1",
    getPlanLimits: async () => ({
      plan: { foodAttributesEnabled: false }
    })
  };

  assert.equal(
    await isFoodAttributesEnabledForRestaurant(
      "restaurant-1",
      baseDependencies as any
    ),
    false
  );

  assert.equal(
    await isFoodAttributesEnabledForRestaurant("restaurant-1", {
      ...baseDependencies,
      getPlanLimits: async () => ({
        plan: { foodAttributesEnabled: true }
      })
    } as any),
    true
  );

  assert.equal(
    await isFoodAttributesEnabledForRestaurant("restaurant-1", {
      ...baseDependencies,
      resolveOwnerByRestaurant: async () => null
    } as any),
    false
  );

  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    assert.equal(
      await isFoodAttributesEnabledForRestaurant("restaurant-1", {
        ...baseDependencies,
        getPlanLimits: async () => {
          throw new Error("subscription unavailable");
        }
      } as any),
      false
    );
  } finally {
    console.error = originalConsoleError;
  }
}

async function run() {
  testFreeMenuResponseHidesOnlyFoodAttributes();
  testPlusMenuResponseIncludesFoodAttributes();
  testFreePreviewHidesOnlyFoodAttributes();
  await testEntitlementRequiresAnExplicitEnabledFlag();
  console.log("food attribute entitlement tests passed");
}

run();
