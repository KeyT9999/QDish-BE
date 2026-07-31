import assert from "node:assert/strict";
import mongoose from "mongoose";

import {
  aggregateCustomerSegments,
  buildDiningVisitQuery,
  countDiningVisitResponses
} from "../services/merchantInsightService.js";

const restaurantA = new mongoose.Types.ObjectId();

function testBuildsRestaurantScopedQuery() {
  const start = new Date("2026-07-01T00:00:00.000Z");
  const end = new Date("2026-07-31T23:59:59.999Z");
  const query = buildDiningVisitQuery(restaurantA.toString(), start, end) as {
    restaurantId: mongoose.Types.ObjectId;
    recordedAt: { $gte: Date; $lte: Date };
  };

  assert.equal(query.restaurantId.toString(), restaurantA.toString());
  assert.deepEqual(query.recordedAt, { $gte: start, $lte: end });
}

function testAggregatesSurveySelections() {
  const segments = aggregateCustomerSegments([
    { goalsSnapshot: ["BALANCED", "LIGHT_MEAL"] },
    { goalsSnapshot: ["BALANCED"] }
  ]);

  assert.equal(segments.find((segment) => segment.segment === "BALANCED")?.count, 2);
  assert.equal(segments.find((segment) => segment.segment === "LIGHT_MEAL")?.count, 1);
  assert.equal(segments.find((segment) => segment.segment === "MUSCLE_GAIN")?.count, 0);
}

function testEmptyVisitsReturnRealZeroValues() {
  const segments = aggregateCustomerSegments([]);

  assert.equal(segments.length, 6);
  assert.ok(segments.every((segment) => segment.count === 0));
  assert.equal(segments.reduce((sum, segment) => sum + segment.count, 0), 0);
}

function testCountsSurveyResponsesSeparatelyFromGoalSelections() {
  const visits = [
    { goalsSnapshot: ["BALANCED", "LIGHT_MEAL"] },
    { goalsSnapshot: ["BALANCED"] }
  ];

  assert.equal(countDiningVisitResponses(visits), 2);
  assert.equal(
    aggregateCustomerSegments(visits).reduce((sum, segment) => sum + segment.count, 0),
    3
  );
}

function run() {
  testBuildsRestaurantScopedQuery();
  testAggregatesSurveySelections();
  testEmptyVisitsReturnRealZeroValues();
  testCountsSurveyResponsesSeparatelyFromGoalSelections();
  console.log("merchant insight isolation tests passed");
}

run();
