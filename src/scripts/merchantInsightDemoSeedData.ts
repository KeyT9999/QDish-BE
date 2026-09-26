import {
  parseKurumiSeedOptions,
  type KurumiSeedOptions
} from "./kurumiMenuSeedData.js";

export const DEMO_SURVEY_BATCH_ID = "anvatcuti2-qdish-survey-demo-v1-20260925";
export const DEMO_SURVEY_TARGET_COUNT = 20;
export const DEMO_SURVEY_MAX_PROFILE_COUNT = 14;
export const DEMO_SURVEY_ACCOUNT = "anvatcuti2";
export const DEMO_SURVEY_RESTAURANT = "KURUMI - Healthy Vegan Food & Desserts";

export function getDemoSurveySeedConnectionOptions() {
  return {
    serverSelectionTimeoutMS: 10000,
    autoCreate: false,
    autoIndex: false
  } as const;
}

export interface DemoSurveyProfile {
  batchId: string;
  responseKey: string;
  goalsSnapshot: string[];
  dietaryPreferencesSnapshot: string[];
  source: "DEMO_SEED";
  recordedAt: Date;
}

export interface DemoSurveySeedOptions extends KurumiSeedOptions {
  cleanup: boolean;
}

const PROFILE_DEFINITIONS: ReadonlyArray<{
  goal: string;
  preferences: readonly string[];
}> = [
  { goal: "LIGHT_MEAL", preferences: ["VEGAN", "LOW_CARB"] },
  { goal: "BALANCED", preferences: ["VEGAN"] },
  { goal: "LIGHT_MEAL", preferences: ["VEGAN", "SUGAR_FREE"] },
  { goal: "COMFORT", preferences: ["VEGAN"] },
  { goal: "BALANCED", preferences: ["VEGAN", "HIGH_PROTEIN"] },
  { goal: "WEIGHT_LOSS", preferences: ["VEGAN", "LOW_CARB", "SUGAR_FREE"] },
  { goal: "LIGHT_MEAL", preferences: ["VEGAN"] },
  { goal: "ENERGY_BOOST", preferences: ["VEGAN"] },
  { goal: "BALANCED", preferences: ["VEGAN"] },
  { goal: "LIGHT_MEAL", preferences: ["VEGAN", "SUGAR_FREE"] },
  { goal: "COMFORT", preferences: ["VEGAN"] },
  { goal: "WEIGHT_LOSS", preferences: ["VEGAN", "LOW_CARB"] },
  { goal: "BALANCED", preferences: ["VEGAN", "HIGH_PROTEIN"] },
  { goal: "LIGHT_MEAL", preferences: ["VEGAN"] }
];

export function buildDemoSurveyProfiles(now = new Date()): DemoSurveyProfile[] {
  return PROFILE_DEFINITIONS.map((definition, index) => ({
    batchId: DEMO_SURVEY_BATCH_ID,
    responseKey: `response-${String(index + 1).padStart(2, "0")}`,
    goalsSnapshot: [definition.goal],
    dietaryPreferencesSnapshot: [...definition.preferences],
    source: "DEMO_SEED",
    recordedAt: new Date(now.getTime() - (PROFILE_DEFINITIONS.length - index - 1) * 12 * 60 * 60 * 1000)
  }));
}

export function buildDemoSurveySeedPlan(
  realSurveyCount: number,
  demoSurveyCount: number,
  existingResponseKeys: readonly string[],
  now = new Date()
): { toInsert: DemoSurveyProfile[]; totalAfterApply: number } {
  if (
    !Number.isSafeInteger(realSurveyCount) || realSurveyCount < 0 ||
    !Number.isSafeInteger(demoSurveyCount) || demoSurveyCount < 0
  ) {
    throw new Error("Survey counts must be non-negative integers");
  }

  const currentTotal = realSurveyCount + demoSurveyCount;
  const missingCount = Math.max(0, DEMO_SURVEY_TARGET_COUNT - currentTotal);
  const existingKeys = new Set(existingResponseKeys);
  const availableProfiles = buildDemoSurveyProfiles(now)
    .filter((profile) => !existingKeys.has(profile.responseKey));

  if (missingCount > availableProfiles.length) {
    throw new Error("Demo survey profile capacity is lower than the remaining target shortfall");
  }

  const toInsert = availableProfiles.slice(0, missingCount);
  return {
    toInsert,
    totalAfterApply: currentTotal + toInsert.length
  };
}

export function assertDemoSurveySeedTarget(username: string, restaurantName: string): void {
  if (
    username.toLocaleLowerCase("en-US") !== DEMO_SURVEY_ACCOUNT ||
    restaurantName !== DEMO_SURVEY_RESTAURANT
  ) {
    throw new Error("Demo survey seed target does not match the approved account and restaurant");
  }
}

export function parseDemoSurveySeedOptions(args: readonly string[]): DemoSurveySeedOptions {
  const cleanupFlags = args.filter((argument) => argument === "--cleanup");
  if (cleanupFlags.length > 1) throw new Error("Duplicate option: --cleanup");
  const cleanup = cleanupFlags.length === 1;
  const options = parseKurumiSeedOptions(args.filter((argument) => argument !== "--cleanup"));
  if (options.help) return { ...options, cleanup: false };
  if (options.username !== DEMO_SURVEY_ACCOUNT) {
    throw new Error("Demo survey seed only supports the approved account target");
  }
  if (cleanup && !options.apply) {
    throw new Error("--cleanup requires --apply and explicit target confirmation");
  }
  return { ...options, cleanup };
}
