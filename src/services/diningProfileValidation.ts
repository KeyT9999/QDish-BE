import mongoose from "mongoose";
import type { BatchFitScoreInput } from "./batchFitScoreService.js";

export const DINING_GOALS = ["MUSCLE_GAIN", "ENERGY_BOOST", "LIGHT_MEAL", "COMFORT", "BALANCED", "WEIGHT_LOSS", "MAINTENANCE", "GENERAL_HEALTH"] as const;
export const DINING_PREFERENCES = ["VEGAN", "VEGETARIAN", "LOW_CARB", "HIGH_PROTEIN", "KETO", "GLUTEN_FREE", "LOW_FAT", "SUGAR_FREE"] as const;
export const DINING_ALLERGIES = ["GLUTEN", "DAIRY", "NUTS", "SHELLFISH", "SOY", "EGGS", "FISH"] as const;

export interface DiningProfileSnapshot {
  goals: string[];
  preferences: string[];
  allergies: string[];
}

export interface RecommendationContextInput {
  timeOfDay?: "breakfast" | "lunch" | "dinner" | "late_night";
  postWorkout?: boolean;
  weather?: "hot" | "cold" | "rainy";
  occasion?: "casual" | "date" | "family";
}

export interface RecommendationRequestInput {
  restaurantId: string;
  userProfile?: DiningProfileSnapshot;
  context?: RecommendationContextInput;
  userId?: string;
}

type ValidationResult =
  | { ok: true; value: RecommendationRequestInput }
  | { ok: false };

const BATCH_TIME_OF_DAY = new Set(["breakfast", "lunch", "dinner", "late_night"]);
const BATCH_WEATHER = new Set(["hot", "rainy", "cool", "cold"]);
const RECOMMENDATION_WEATHER = new Set(["hot", "cold", "rainy"]);
const RECOMMENDATION_OCCASIONS = new Set(["casual", "date", "family"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function hasOnlyAllowedValues(value: unknown, allowedValues: readonly string[]): value is string[] {
  return Array.isArray(value)
    && value.length <= 10
    && value.every((item) => typeof item === "string" && allowedValues.includes(item))
    && new Set(value).size === value.length;
}

function parseDiningProfile(value: unknown): DiningProfileSnapshot | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["goals", "preferences", "allergies"])) {
    return undefined;
  }

  if (
    !hasOnlyAllowedValues(value.goals, DINING_GOALS)
    || !hasOnlyAllowedValues(value.preferences, DINING_PREFERENCES)
    || !hasOnlyAllowedValues(value.allergies, DINING_ALLERGIES)
  ) {
    return undefined;
  }

  return {
    goals: value.goals,
    preferences: value.preferences,
    allergies: value.allergies,
  };
}

function isValidBatchContext(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["timeOfDay", "postWorkout", "weather", "occasion"])) {
    return false;
  }

  return (
    (value.timeOfDay === undefined || (typeof value.timeOfDay === "string" && BATCH_TIME_OF_DAY.has(value.timeOfDay)))
    && (value.postWorkout === undefined || typeof value.postWorkout === "boolean")
    && (value.weather === undefined || (typeof value.weather === "string" && BATCH_WEATHER.has(value.weather)))
    && (value.occasion === undefined || typeof value.occasion === "string")
  );
}

function parseRecommendationContext(value: unknown): RecommendationContextInput | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["timeOfDay", "postWorkout", "weather", "occasion"])) {
    return undefined;
  }

  if (
    (value.timeOfDay !== undefined && (typeof value.timeOfDay !== "string" || !BATCH_TIME_OF_DAY.has(value.timeOfDay)))
    || (value.postWorkout !== undefined && typeof value.postWorkout !== "boolean")
    || (value.weather !== undefined && (typeof value.weather !== "string" || !RECOMMENDATION_WEATHER.has(value.weather)))
    || (value.occasion !== undefined && (typeof value.occasion !== "string" || !RECOMMENDATION_OCCASIONS.has(value.occasion)))
  ) {
    return undefined;
  }

  return {
    ...(value.timeOfDay === undefined ? {} : { timeOfDay: value.timeOfDay as RecommendationContextInput["timeOfDay"] }),
    ...(value.postWorkout === undefined ? {} : { postWorkout: value.postWorkout }),
    ...(value.weather === undefined ? {} : { weather: value.weather as RecommendationContextInput["weather"] }),
    ...(value.occasion === undefined ? {} : { occasion: value.occasion as RecommendationContextInput["occasion"] }),
  };
}

function hasValidRestaurantId(value: unknown): value is string {
  return typeof value === "string" && mongoose.isObjectIdOrHexString(value);
}

export function isValidBatchFitScoreInput(value: unknown): value is BatchFitScoreInput {
  if (!isRecord(value) || !hasExactKeys(value, ["restaurantId", "userProfile", "context", "userId"])) {
    return false;
  }

  if (!hasValidRestaurantId(value.restaurantId) || parseDiningProfile(value.userProfile) === undefined) {
    return false;
  }

  if (value.context !== undefined && !isValidBatchContext(value.context)) {
    return false;
  }

  return value.userId === undefined || typeof value.userId === "string";
}

export function parseRecommendationRequest(value: unknown): ValidationResult {
  if (!isRecord(value) || !hasExactKeys(value, ["restaurantId", "userProfile", "context", "userId"])) {
    return { ok: false };
  }

  if (!hasValidRestaurantId(value.restaurantId) || (value.userId !== undefined && typeof value.userId !== "string")) {
    return { ok: false };
  }

  const userProfile = value.userProfile === undefined ? undefined : parseDiningProfile(value.userProfile);
  const context = value.context === undefined ? undefined : parseRecommendationContext(value.context);
  if ((value.userProfile !== undefined && userProfile === undefined) || (value.context !== undefined && context === undefined)) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      restaurantId: value.restaurantId,
      ...(userProfile === undefined ? {} : { userProfile }),
      ...(context === undefined ? {} : { context }),
      ...(value.userId === undefined ? {} : { userId: value.userId }),
    },
  };
}
