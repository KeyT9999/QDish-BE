import assert from "node:assert/strict";

import { createMerchantInsightHandler } from "../routes/insightRoutes.js";

const restaurantId = "507f1f77bcf86cd799439011";
const ownerId = "507f1f77bcf86cd799439012";

const completeInsights = {
  menuCoverage: { totalItems: 10, itemsWithRecipe: 8, coveragePct: 80 },
  attributeDistribution: { HIGH_PROTEIN: 4 },
  topDishes: [{ dishId: "dish-1", name: "Chicken Bowl", orderCount: 5, revenue: 500000 }],
  customerSegments: [{ segment: "BALANCED", count: 3, label: "Balanced" }],
  surveyResponseCount: 3,
  gapAnalysis: ["Add vegan dishes"],
  peakHours: {
    periods: [{ period: "Lunch", count: 5, percentage: 100 }],
    hourly: Array(24).fill(0)
  }
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
      }
    }
  };
}

function makeRequest() {
  return {
    auth: { role: "RESTAURANT_OWNER", sub: ownerId },
    query: { restaurantId, period: "month" }
  };
}

function makeDependencies(plan: {
  personalizedMenuEnabled: boolean;
  customerInsightsEnabled: boolean;
}) {
  let insightsCalls = 0;
  return {
    dependencies: {
      resolveOwnerByRestaurant: async () => ({ toString: () => ownerId }),
      getPlanLimits: async () => ({ plan }),
      getInsights: async () => {
        insightsCalls += 1;
        return completeInsights;
      }
    },
    getInsightsCalls: () => insightsCalls
  };
}

async function testPlusCanOnlyReceiveMenuInsights() {
  const plus = makeDependencies({
    personalizedMenuEnabled: true,
    customerInsightsEnabled: false
  });
  const result = makeResponse();

  await createMerchantInsightHandler("menu", plus.dependencies as any)(
    makeRequest() as any,
    result.response as any
  );

  assert.equal(result.state.statusCode, 200);
  assert.deepEqual(Object.keys(result.state.body as object).sort(), [
    "attributeDistribution",
    "menuCoverage",
    "topDishes"
  ]);
  assert.equal(plus.getInsightsCalls(), 1);
}

async function testPlusCannotCallCustomerOrLegacyInsights() {
  for (const scope of ["customer", "legacy"] as const) {
    const plus = makeDependencies({
      personalizedMenuEnabled: true,
      customerInsightsEnabled: false
    });
    const result = makeResponse();

    await createMerchantInsightHandler(scope, plus.dependencies as any)(
      makeRequest() as any,
      result.response as any
    );

    assert.equal(result.state.statusCode, 403);
    assert.equal(plus.getInsightsCalls(), 0);
  }
}

async function testProReceivesOnlyCustomerInsightFields() {
  const pro = makeDependencies({
    personalizedMenuEnabled: true,
    customerInsightsEnabled: true
  });
  const result = makeResponse();

  await createMerchantInsightHandler("customer", pro.dependencies as any)(
    makeRequest() as any,
    result.response as any
  );

  assert.equal(result.state.statusCode, 200);
  assert.deepEqual(Object.keys(result.state.body as object).sort(), [
    "customerSegments",
    "gapAnalysis",
    "peakHours",
    "surveyResponseCount"
  ]);
}

async function run() {
  await testPlusCanOnlyReceiveMenuInsights();
  await testPlusCannotCallCustomerOrLegacyInsights();
  await testProReceivesOnlyCustomerInsightFields();
  console.log("insight entitlement tests passed");
}

run();
