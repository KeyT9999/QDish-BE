import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  BatchFitScoreDependencies,
  calculateBatchFitScores,
} from "../services/batchFitScoreService.js";
import { FitScoreEngine } from "../engines/fitScore/FitScoreEngine.js";
import { createBatchFitScoreHandler } from "../routes/fitScoreRoutes.js";

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
        allergens: [],
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

const routeRestaurantId = "507f1f77bcf86cd799439011";
const expectedScores = {
  "507f1f77bcf86cd799439013": {
    score: 92,
    label: "Rất phù hợp",
    contextType: "gym_fit",
    reasons: ["Hỗ trợ mục tiêu MUSCLE_GAIN"],
    blocked: false,
  },
};

function makeBatchRequest(body: unknown) {
  return { body };
}

function makeBatchResponse() {
  const state: { statusCode: number; body?: unknown } = { statusCode: 200 };
  return {
    state,
    response: {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      json(body: unknown) {
        state.body = body;
        return this;
      },
    },
  };
}

function validBatchInput() {
  return {
    restaurantId: routeRestaurantId,
    userProfile: {
      goals: ["MUSCLE_GAIN"],
      allergies: ["SOY"],
      preferences: ["HIGH_PROTEIN"],
    },
    context: { timeOfDay: "lunch", postWorkout: true },
  };
}

function makeBatchRouteDependencies(plan: {
  fitScoreEnabled: boolean;
  recommendationEnabled: boolean;
} | null) {
  let calculateCalls = 0;
  return {
    dependencies: {
      resolveOwnerByRestaurant: async () => "owner-1",
      getPlanLimits: async () => ({ plan }),
      calculateBatchFitScores: async () => {
        calculateCalls += 1;
        return expectedScores;
      },
    },
    calculateCalls: () => calculateCalls,
  };
}

async function testFitScoreRequiresItsOwnEntitlement() {
  const disabled = makeBatchRouteDependencies({
    fitScoreEnabled: false,
    recommendationEnabled: true,
  });
  const disabledResponse = makeBatchResponse();

  await createBatchFitScoreHandler(disabled.dependencies as any)(
    makeBatchRequest(validBatchInput()) as any,
    disabledResponse.response as any
  );

  assert.equal(disabledResponse.state.statusCode, 403);
  assert.deepEqual(disabledResponse.state.body, {
    error: {
      code: "FIT_SCORE_NOT_AVAILABLE",
      message: "Fit Score không khả dụng cho gói dịch vụ này",
    },
  });
  assert.equal(disabled.calculateCalls(), 0);

  const enabled = makeBatchRouteDependencies({
    fitScoreEnabled: true,
    recommendationEnabled: false,
  });
  const enabledResponse = makeBatchResponse();

  await createBatchFitScoreHandler(enabled.dependencies as any)(
    makeBatchRequest(validBatchInput()) as any,
    enabledResponse.response as any
  );

  assert.equal(enabledResponse.state.statusCode, 200);
  assert.deepEqual(enabledResponse.state.body, { scores: expectedScores });
  assert.equal(enabled.calculateCalls(), 1);

  const missingPlan = makeBatchRouteDependencies(null);
  const missingPlanResponse = makeBatchResponse();

  await createBatchFitScoreHandler(missingPlan.dependencies as any)(
    makeBatchRequest(validBatchInput()) as any,
    missingPlanResponse.response as any
  );

  assert.equal(missingPlanResponse.state.statusCode, 403);
  assert.deepEqual(missingPlanResponse.state.body, {
    error: {
      code: "FIT_SCORE_NOT_AVAILABLE",
      message: "Fit Score kh\u00f4ng kh\u1ea3 d\u1ee5ng cho g\u00f3i d\u1ecbch v\u1ee5 n\u00e0y",
    },
  });
  assert.equal(missingPlan.calculateCalls(), 0);
}

async function testBatchRouteRejectsInvalidRequests() {
  const invalidBodies = [
    { ...validBatchInput(), restaurantId: "not-an-object-id" },
    {
      ...validBatchInput(),
      userProfile: { ...validBatchInput().userProfile, goals: Array(11).fill("MUSCLE_GAIN") },
    },
    {
      ...validBatchInput(),
      userProfile: { ...validBatchInput().userProfile, allergies: Array(11).fill("SOY") },
    },
    {
      ...validBatchInput(),
      userProfile: { ...validBatchInput().userProfile, preferences: Array(11).fill("HIGH_PROTEIN") },
    },
    {
      ...validBatchInput(),
      userProfile: { ...validBatchInput().userProfile, goals: ["NOT_A_GOAL"] },
    },
    {
      ...validBatchInput(),
      userProfile: { ...validBatchInput().userProfile, preferences: ["NOT_A_PREFERENCE"] },
    },
    {
      ...validBatchInput(),
      userProfile: { ...validBatchInput().userProfile, allergies: ["NOT_AN_ALLERGY"] },
    },
    {
      ...validBatchInput(),
      userProfile: { ...validBatchInput().userProfile, goals: ["MUSCLE_GAIN", "MUSCLE_GAIN"] },
    },
    {
      ...validBatchInput(),
      userProfile: { ...validBatchInput().userProfile, preferences: ["HIGH_PROTEIN", "HIGH_PROTEIN"] },
    },
    {
      ...validBatchInput(),
      userProfile: { ...validBatchInput().userProfile, allergies: ["SOY", "SOY"] },
    },
    { ...validBatchInput(), context: { timeOfDay: "midnight_snack" } },
    { ...validBatchInput(), context: { postWorkout: "false" } },
    { ...validBatchInput(), context: { weather: "stormy" } },
    { ...validBatchInput(), context: { occasion: 123 } },
  ];

  for (const body of invalidBodies) {
    const route = makeBatchRouteDependencies({
      fitScoreEnabled: true,
      recommendationEnabled: false,
    });
    const result = makeBatchResponse();

    await createBatchFitScoreHandler(route.dependencies as any)(
      makeBatchRequest(body) as any,
      result.response as any
    );

    assert.equal(result.state.statusCode, 400);
    assert.deepEqual(result.state.body, {
      error: {
        code: "INVALID_FIT_SCORE_REQUEST",
        message: "Yêu cầu Fit Score không hợp lệ",
      },
    });
    assert.equal(route.calculateCalls(), 0);
  }
}

assert.equal(FitScoreEngine.resolvePrimaryScoreType({
  goals: ["LIGHT_MEAL"],
  preferences: [],
  allergies: [],
}), "quick_lunch_fit");

await testFitScoreRequiresItsOwnEntitlement();
await testBatchRouteRejectsInvalidRequests();

console.log("Batch Fit Score service tests passed.");
