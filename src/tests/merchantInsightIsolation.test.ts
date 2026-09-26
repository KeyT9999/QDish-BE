import assert from "node:assert/strict";
import mongoose from "mongoose";

import {
  aggregateCustomerSegments,
  buildCustomerSegmentsFromCounts,
  buildDemoSurveyQuery,
  buildDiningVisitQuery,
  countCompletedOrders,
  countDiningVisitResponses,
  mergeCustomerSegmentCounts
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

function testBuildsDemoSurveyQueryScopedToRestaurantAndPeriod() {
  const start = new Date("2026-09-01T00:00:00.000Z");
  const end = new Date("2026-09-30T23:59:59.999Z");
  const query = buildDemoSurveyQuery(restaurantA.toString(), start, end) as {
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

function testBuildsSegmentsFromDatabaseAggregationRows() {
  const segments = buildCustomerSegmentsFromCounts([
    { _id: "BALANCED", count: 2 },
    { _id: "LIGHT_MEAL", count: 1 }
  ]);

  assert.equal(segments.find((segment) => segment.segment === "BALANCED")?.count, 2);
  assert.equal(segments.find((segment) => segment.segment === "LIGHT_MEAL")?.count, 1);
  assert.equal(segments.find((segment) => segment.segment === "MUSCLE_GAIN")?.count, 0);
}

function testIgnoresUnexpectedSegmentKeysFromStoredData() {
  const rows = [
    { _id: "__proto__", count: 99 },
    { _id: "constructor", count: 98 },
    { _id: "toString", count: 97 }
  ];

  assert.ok(buildCustomerSegmentsFromCounts(rows).every((segment) => segment.count === 0));
  assert.ok(
    aggregateCustomerSegments([
      { goalsSnapshot: ["__proto__", "constructor", "toString"] }
    ]).every((segment) => segment.count === 0)
  );
}

function testCombinesRealAndDemoSurveyGoalCountsWithoutConflatingResponses() {
  const segments = mergeCustomerSegmentCounts(
    [
      { _id: "BALANCED", count: 4 },
      { _id: "LIGHT_MEAL", count: 2 }
    ],
    [
      { _id: "BALANCED", count: 4 },
      { _id: "LIGHT_MEAL", count: 5 },
      { _id: "COMFORT", count: 2 }
    ]
  );

  assert.equal(segments.find((segment) => segment.segment === "BALANCED")?.count, 8);
  assert.equal(segments.find((segment) => segment.segment === "LIGHT_MEAL")?.count, 7);
  assert.equal(segments.find((segment) => segment.segment === "COMFORT")?.count, 2);
}

function testCountsCompletedOrderDocumentsInsteadOfSoldUnits() {
  const completedOrders = Array.from({ length: 24 }, (_, index) => ({
    _id: `order-${index}`,
    items: [{ menuItemId: "dish-1", quantity: index === 0 ? 29 : 1 }]
  }));

  assert.equal(countCompletedOrders(completedOrders), 24);
  assert.equal(
    completedOrders.reduce((units, order) => units + order.items[0].quantity, 0),
    52
  );
}

function run() {
  testBuildsRestaurantScopedQuery();
  testBuildsDemoSurveyQueryScopedToRestaurantAndPeriod();
  testAggregatesSurveySelections();
  testEmptyVisitsReturnRealZeroValues();
  testCountsSurveyResponsesSeparatelyFromGoalSelections();
  testBuildsSegmentsFromDatabaseAggregationRows();
  testIgnoresUnexpectedSegmentKeysFromStoredData();
  testCombinesRealAndDemoSurveyGoalCountsWithoutConflatingResponses();
  testCountsCompletedOrderDocumentsInsteadOfSoldUnits();
  console.log("merchant insight isolation tests passed");
}

run();
