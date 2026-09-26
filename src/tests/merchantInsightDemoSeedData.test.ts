import assert from "node:assert/strict";
import { assertKurumiSeedTarget } from "../scripts/kurumiMenuSeedData.js";
import { AnonymousDiningVisit } from "../models/AnonymousDiningVisit.js";
import { MerchantInsightDemoSurvey } from "../models/MerchantInsightDemoSurvey.js";
import {
  buildDemoSurveyProfiles,
  buildDemoSurveySeedPlan,
  parseDemoSurveySeedOptions,
  getDemoSurveySeedConnectionOptions,
  assertDemoSurveySeedTarget,
  DEMO_SURVEY_BATCH_ID
} from "../scripts/merchantInsightDemoSeedData.js";

const now = new Date("2026-09-25T12:00:00.000Z");

function testBuildsFourteenPlausibleVeganSurveyProfiles() {
  const profiles = buildDemoSurveyProfiles(now);
  const goalCounts = profiles.reduce<Record<string, number>>((counts, profile) => {
    counts[profile.goalsSnapshot[0]] = (counts[profile.goalsSnapshot[0]] ?? 0) + 1;
    return counts;
  }, {});

  assert.equal(profiles.length, 14);
  assert.deepEqual(goalCounts, {
    LIGHT_MEAL: 5,
    BALANCED: 4,
    WEIGHT_LOSS: 2,
    ENERGY_BOOST: 1,
    COMFORT: 2
  });
  assert.equal(new Set(profiles.map((profile) => profile.responseKey)).size, 14);
  assert.equal(profiles[0].batchId, DEMO_SURVEY_BATCH_ID);
  assert.ok(profiles.every((profile) => profile.source === "DEMO_SEED"));
  assert.ok(profiles.every((profile) => profile.goalsSnapshot.length === 1));
  assert.ok(profiles.every((profile) => profile.dietaryPreferencesSnapshot.includes("VEGAN")));
  assert.ok(profiles.every((profile) => profile.recordedAt <= now));
  assert.ok(profiles.every((profile) => profile.recordedAt >= new Date(now.getTime() - 7 * 86400000)));
}

function testPlansOnlyTheNumberNeededAndRerunsIdempotently() {
  const profiles = buildDemoSurveyProfiles(now);
  const initial = buildDemoSurveySeedPlan(6, 0, [], now);
  assert.equal(initial.toInsert.length, 14);
  assert.equal(initial.totalAfterApply, 20);

  const afterApply = buildDemoSurveySeedPlan(
    6,
    14,
    profiles.map((profile) => profile.responseKey),
    now
  );
  assert.equal(afterApply.toInsert.length, 0);
  assert.equal(afterApply.totalAfterApply, 20);

  const partial = buildDemoSurveySeedPlan(
    6,
    10,
    profiles.slice(0, 10).map((profile) => profile.responseKey),
    now
  );
  assert.equal(partial.toInsert.length, 4);
  assert.deepEqual(
    partial.toInsert.map((profile) => profile.responseKey),
    profiles.slice(10, 14).map((profile) => profile.responseKey)
  );
}

function testDoesNotSeedWhenTargetIsAlreadyMetAndFailsClosedOnUnexpectedShortfall() {
  assert.equal(buildDemoSurveySeedPlan(20, 0, [], now).toInsert.length, 0);
  assert.throws(() => buildDemoSurveySeedPlan(0, 0, [], now), /profile capacity/i);
}

function testRequiresExactAccountAndRestaurant() {
  assert.doesNotThrow(() => assertDemoSurveySeedTarget(
    "anvatcuti2",
    "KURUMI - Healthy Vegan Food & Desserts"
  ));
  assert.throws(() => assertDemoSurveySeedTarget("another-account", "KURUMI - Healthy Vegan Food & Desserts"), /target/i);
  assert.throws(() => assertDemoSurveySeedTarget("anvatcuti2", "Different Restaurant"), /target/i);
}

function testSeedOptionsAreDryRunByDefaultAndGuardApplyAndCleanup() {
  assert.deepEqual(parseDemoSurveySeedOptions(["--username", "Anvatcuti2"]), {
    help: false,
    username: "anvatcuti2",
    apply: false,
    cleanup: false,
    confirmDb: undefined,
    confirmHost: undefined
  });
  assert.throws(() => parseDemoSurveySeedOptions(["--username", "anvatcuti2", "--cleanup"]), /apply/i);
  assert.throws(() => parseDemoSurveySeedOptions(["--username", "other", "--apply", "--confirm-db", "QDish", "--confirm-host", "host.mongodb.net"]), /target/i);

  const applyOptions = parseDemoSurveySeedOptions([
    "--username", "ANVATCUTI2", "--apply", "--confirm-db", "QDish",
    "--confirm-host", "kimthang.mh3rrz2.mongodb.net"
  ]);
  assert.equal(applyOptions.apply, true);
  assert.equal(applyOptions.cleanup, false);

  const cleanupOptions = parseDemoSurveySeedOptions([
    "--username", "anvatcuti2", "--apply", "--cleanup", "--confirm-db", "QDish",
    "--confirm-host", "kimthang.mh3rrz2.mongodb.net"
  ]);
  assert.equal(cleanupOptions.cleanup, true);
  const mismatchedHostOptions = parseDemoSurveySeedOptions([
    "--username", "anvatcuti2", "--apply", "--confirm-db", "QDish", "--confirm-host", "example.org"
  ]);
  assert.throws(() => assertKurumiSeedTarget(
    "mongodb+srv://kimthang.mh3rrz2.mongodb.net/QDish",
    mismatchedHostOptions
  ), /host/i);
}

function testDemoSurveysLiveInAnIsolatedCollection() {
  assert.notEqual(
    MerchantInsightDemoSurvey.collection.collectionName,
    AnonymousDiningVisit.collection.collectionName
  );
  assert.equal(MerchantInsightDemoSurvey.schema.path("source").options.immutable, true);
  assert.equal(MerchantInsightDemoSurvey.schema.path("tableSessionId"), undefined);
  assert.equal(MerchantInsightDemoSurvey.schema.path("visitToken"), undefined);
}

function testDemoSurveyModelDoesNotProvisionStorageOnApiStartup() {
  assert.equal(MerchantInsightDemoSurvey.schema.options.autoCreate, false);
  assert.equal(MerchantInsightDemoSurvey.schema.options.autoIndex, false);
}

function testSeedConnectionCannotAutomaticallyProvisionUnrelatedModels() {
  assert.deepEqual(getDemoSurveySeedConnectionOptions(), {
    serverSelectionTimeoutMS: 10000,
    autoCreate: false,
    autoIndex: false
  });
}

testBuildsFourteenPlausibleVeganSurveyProfiles();
testPlansOnlyTheNumberNeededAndRerunsIdempotently();
testDoesNotSeedWhenTargetIsAlreadyMetAndFailsClosedOnUnexpectedShortfall();
testRequiresExactAccountAndRestaurant();
testSeedOptionsAreDryRunByDefaultAndGuardApplyAndCleanup();
testDemoSurveysLiveInAnIsolatedCollection();
testDemoSurveyModelDoesNotProvisionStorageOnApiStartup();
testSeedConnectionCannotAutomaticallyProvisionUnrelatedModels();
console.log("merchant insight demo seed data tests passed");
