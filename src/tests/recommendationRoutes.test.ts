import assert from "node:assert/strict";

import type { RecommendationResponse } from "../engines/recommendation/RecommendationEngine.js";
import { createRecommendationHandler } from "../routes/recommendationRoutes.js";
import type {
  DiningProfileSnapshot,
  RecommendationContextInput,
} from "../services/diningProfileValidation.js";

const restaurantId = "507f1f77bcf86cd799439011";
const genericRecommendation: RecommendationResponse = {
  mode: "GENERAL",
  bestForYou: [],
  fullMenu: [],
  pairingSuggestions: [],
};

function makeResponse() {
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

function makeHandler(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const handler = createRecommendationHandler({
    resolveOwnerByRestaurant: async () => {
      calls.push("owner");
      return "owner-id" as never;
    },
    getPlanLimits: async () => {
      calls.push("plan");
      return { plan: { recommendationEnabled: true } } as never;
    },
    generateRecommendations: async (
      _restaurantId: string,
      profile?: DiningProfileSnapshot,
      context?: RecommendationContextInput,
    ) => {
      calls.push(JSON.stringify({ profile, context }));
      return genericRecommendation;
    },
    ...overrides,
  } as any);

  return { calls, handler };
}

async function invoke(handler: ReturnType<typeof createRecommendationHandler>, body: unknown) {
  const result = makeResponse();
  await handler({ body } as any, result.response as any);
  return result.state;
}

async function testInvalidRequestsAreRejectedBeforeDependencies() {
  const invalidBodies = [
    { restaurantId: "not-an-object-id" },
    { restaurantId: { $ne: null } },
    { restaurantId, userProfile: { goals: "BALANCED", preferences: [], allergies: [] } },
    { restaurantId, userProfile: { goals: ["BALANCED", "BALANCED"], preferences: [], allergies: [] } },
    { restaurantId, userProfile: { goals: ["UNKNOWN"], preferences: [], allergies: [] } },
    { restaurantId, context: { weather: "storm" } },
  ];

  for (const body of invalidBodies) {
    const { calls, handler } = makeHandler();
    const result = await invoke(handler, body);

    assert.equal(result.statusCode, 400);
    assert.deepEqual(calls, []);
  }
}

async function testInlineProfileAndContextReachEngine() {
  const { calls, handler } = makeHandler();
  const userProfile = {
    goals: ["BALANCED"],
    preferences: ["VEGAN"],
    allergies: ["NUTS"],
  };
  const context = {
    timeOfDay: "lunch" as const,
    postWorkout: false,
    weather: "rainy" as const,
    occasion: "casual" as const,
  };

  const result = await invoke(handler, { restaurantId, userProfile, context });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, genericRecommendation);
  assert.deepEqual(calls, [
    "owner",
    "plan",
    JSON.stringify({ profile: userProfile, context }),
  ]);
}

async function testLegacyUserIdUsesGeneralModeWithoutProfileLookup() {
  const { calls, handler } = makeHandler();

  const result = await invoke(handler, { restaurantId, userId: "legacy-guest" });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, genericRecommendation);
  assert.deepEqual(calls, [
    "owner",
    "plan",
    JSON.stringify({ profile: undefined, context: undefined }),
  ]);
}

async function testOwnerAndPlanEntitlementsRemainIntact() {
  const missingOwner = makeHandler({
    resolveOwnerByRestaurant: async () => null,
  });
  const missingOwnerResult = await invoke(missingOwner.handler, { restaurantId });
  assert.equal(missingOwnerResult.statusCode, 404);
  assert.deepEqual(missingOwner.calls, []);

  const disabledPlan = makeHandler({
    getPlanLimits: async () => ({ plan: { recommendationEnabled: false } }),
  });
  const disabledPlanResult = await invoke(disabledPlan.handler, { restaurantId });
  assert.equal(disabledPlanResult.statusCode, 403);
  assert.deepEqual(disabledPlan.calls, ["owner"]);
}

async function testUnexpectedErrorsUseGenericMessage() {
  const { handler } = makeHandler({
    generateRecommendations: async () => {
      throw new Error("database connection details");
    },
  });

  const result = await invoke(handler, { restaurantId });

  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, {
    message: "Lỗi hệ thống khi tạo gợi ý món ăn phù hợp.",
  });
}

async function run() {
  await testInvalidRequestsAreRejectedBeforeDependencies();
  await testInlineProfileAndContextReachEngine();
  await testLegacyUserIdUsesGeneralModeWithoutProfileLookup();
  await testOwnerAndPlanEntitlementsRemainIntact();
  await testUnexpectedErrorsUseGenericMessage();
  console.log("recommendation route tests passed");
}

run();
