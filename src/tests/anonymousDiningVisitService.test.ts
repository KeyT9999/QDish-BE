import assert from "node:assert/strict";
import mongoose from "mongoose";

import { TableSessionStatus } from "../models/TableSession.js";
import {
  AnonymousDiningVisitServiceError,
  recordAnonymousDiningVisit,
  type AnonymousDiningVisitDependencies,
  type RecordAnonymousDiningVisitInput
} from "../services/anonymousDiningVisitService.js";

const restaurantA = new mongoose.Types.ObjectId();
const restaurantB = new mongoose.Types.ObjectId();
const openSessionId = new mongoose.Types.ObjectId();
const closedSessionId = new mongoose.Types.ObjectId();
const visitTokenA = "5b9c6d8e-8ac1-4fc7-a11d-889e603fa888";
const visitTokenB = "84d5f623-3d71-4b62-8ad2-4959725233c7";

const validInput = (overrides: Partial<RecordAnonymousDiningVisitInput> = {}): RecordAnonymousDiningVisitInput => ({
  restaurantId: restaurantA.toString(),
  tableSessionId: openSessionId.toString(),
  visitToken: visitTokenA,
  goals: ["BALANCED"],
  dietaryPreferences: ["VEGETARIAN"],
  ...overrides
});

const createDependencies = () => {
  const visits = new Map<string, {
    id: string;
    recordedAt: Date;
    goalsSnapshot: string[];
    dietaryPreferencesSnapshot: string[];
  }>();

  const deps: AnonymousDiningVisitDependencies = {
    findTableSession: async (tableSessionId) => {
      if (tableSessionId.equals(openSessionId)) {
        return {
          _id: openSessionId,
          restaurantId: restaurantA,
          status: TableSessionStatus.OPEN
        };
      }
      if (tableSessionId.equals(closedSessionId)) {
        return {
          _id: closedSessionId,
          restaurantId: restaurantA,
          status: TableSessionStatus.CLOSED
        };
      }
      return null;
    },
    upsertVisit: async (input) => {
      const key = `${input.restaurantId}:${input.tableSessionId}:${input.visitToken}`;
      const existing = visits.get(key);
      if (existing) {
        existing.goalsSnapshot = input.goalsSnapshot;
        existing.dietaryPreferencesSnapshot = input.dietaryPreferencesSnapshot;
        return { id: existing.id, recordedAt: existing.recordedAt, created: false };
      }

      const created = {
        id: new mongoose.Types.ObjectId().toString(),
        recordedAt: new Date("2026-07-31T10:00:00.000Z"),
        goalsSnapshot: input.goalsSnapshot,
        dietaryPreferencesSnapshot: input.dietaryPreferencesSnapshot
      };
      visits.set(key, created);
      return { id: created.id, recordedAt: created.recordedAt, created: true };
    }
  };

  return { deps, visits };
};

async function testCreatesAndIdempotentlyUpdatesAVisit() {
  const { deps, visits } = createDependencies();

  const created = await recordAnonymousDiningVisit(validInput(), deps);
  const updated = await recordAnonymousDiningVisit(validInput({
    goals: ["LIGHT_MEAL", "LIGHT_MEAL"],
    dietaryPreferences: ["LOW_CARB"]
  }), deps);

  assert.equal(created.created, true);
  assert.equal(updated.created, false);
  assert.equal(created.id, updated.id);
  assert.equal(visits.size, 1);
  assert.deepEqual([...visits.values()][0].goalsSnapshot, ["LIGHT_MEAL"]);
}

async function testAllowsMultipleSurveyResponsesInOneTableSession() {
  const { deps, visits } = createDependencies();

  const first = await recordAnonymousDiningVisit(validInput(), deps);
  const second = await recordAnonymousDiningVisit(validInput({ visitToken: visitTokenB }), deps);

  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.notEqual(first.id, second.id);
  assert.equal(visits.size, 2);
}

async function testRejectsCrossTenantSession() {
  const { deps } = createDependencies();
  const crossTenantDeps: AnonymousDiningVisitDependencies = {
    ...deps,
    findTableSession: async () => ({
      _id: openSessionId,
      restaurantId: restaurantB,
      status: TableSessionStatus.OPEN
    })
  };

  await assert.rejects(
    recordAnonymousDiningVisit(validInput(), crossTenantDeps),
    (error: unknown) => error instanceof AnonymousDiningVisitServiceError
      && error.statusCode === 404
      && error.code === "TABLE_SESSION_NOT_FOUND"
  );
}

async function testRejectsInactiveSession() {
  const { deps } = createDependencies();

  await assert.rejects(
    recordAnonymousDiningVisit(validInput({ tableSessionId: closedSessionId.toString() }), deps),
    (error: unknown) => error instanceof AnonymousDiningVisitServiceError
      && error.statusCode === 409
      && error.code === "TABLE_SESSION_INACTIVE"
  );
}

async function testRejectsInvalidBoundaryInput() {
  const { deps } = createDependencies();

  await assert.rejects(
    recordAnonymousDiningVisit(validInput({ visitToken: "predictable-token" }), deps),
    (error: unknown) => error instanceof AnonymousDiningVisitServiceError
      && error.statusCode === 400
      && error.code === "INVALID_DINING_VISIT"
  );

  await assert.rejects(
    recordAnonymousDiningVisit(validInput({ goals: ["NOT_A_GOAL"] }), deps),
    (error: unknown) => error instanceof AnonymousDiningVisitServiceError
      && error.statusCode === 400
      && error.code === "INVALID_DINING_VISIT"
  );
}

async function run() {
  await testCreatesAndIdempotentlyUpdatesAVisit();
  await testAllowsMultipleSurveyResponsesInOneTableSession();
  await testRejectsCrossTenantSession();
  await testRejectsInactiveSession();
  await testRejectsInvalidBoundaryInput();
  console.log("anonymous dining visit service tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
