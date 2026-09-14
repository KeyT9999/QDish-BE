import assert from "node:assert/strict";
import {
  isBoundedUniqueAllowedStringList,
  isValidBatchFitScoreInput,
  parseRecommendationRequest,
} from "../services/diningProfileValidation.js";

const restaurantId = "507f1f77bcf86cd799439011";
const validUserProfile = { goals: ["BALANCED"], preferences: ["VEGAN"], allergies: ["NUTS"] };
const genericAllowedValues = Array.from({ length: 11 }, (_, index) => `OPTION_${index}`);

assert.equal(isBoundedUniqueAllowedStringList(genericAllowedValues.slice(0, 10), genericAllowedValues), true);
assert.equal(isBoundedUniqueAllowedStringList(genericAllowedValues, genericAllowedValues), false);

assert.equal(parseRecommendationRequest({ restaurantId }).ok, true);
assert.equal(parseRecommendationRequest({ restaurantId, userId: "legacy-guest" }).ok, true);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  goals: ["BALANCED"], preferences: [], allergies: ["NUTS"],
}}).ok, true);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  goals: [], preferences: [], allergies: [], conditions: ["DIABETES"],
}}).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  goals: ["BALANCED", "BALANCED"], preferences: [], allergies: [],
}}).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  preferences: [], allergies: [],
}}).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  goals: [], allergies: [],
}}).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  goals: [], preferences: [],
}}).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  ...validUserProfile, goals: Array(11).fill("BALANCED"),
}}).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  ...validUserProfile, preferences: Array(11).fill("VEGAN"),
}}).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  ...validUserProfile, allergies: Array(11).fill("NUTS"),
}}).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  ...validUserProfile, goals: ["NOT_A_GOAL"],
}}).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  ...validUserProfile, preferences: ["NOT_A_PREFERENCE"],
}}).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  ...validUserProfile, allergies: ["NOT_AN_ALLERGY"],
}}).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, context: { weather: "storm" } }).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, context: { occasion: { $ne: null } } }).ok, false);
assert.equal(isValidBatchFitScoreInput({ restaurantId, userProfile: {
  goals: [], preferences: [], allergies: [],
}}), true);

assert.equal(parseRecommendationRequest({ restaurantId, userId: 123 }).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, unexpected: true }).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, context: { weather: "cool" } }).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, context: { occasion: "date" } }).ok, true);

const parsedLegacyRequest = parseRecommendationRequest({
  restaurantId,
  userId: "legacy-guest",
  userProfile: { goals: ["BALANCED"], preferences: [], allergies: [] },
  context: { timeOfDay: "lunch", postWorkout: false, weather: "rainy", occasion: "casual" },
});
assert.deepEqual(parsedLegacyRequest, {
  ok: true,
  value: {
    restaurantId,
    userId: "legacy-guest",
    userProfile: { goals: ["BALANCED"], preferences: [], allergies: [] },
    context: { timeOfDay: "lunch", postWorkout: false, weather: "rainy", occasion: "casual" },
  },
});

assert.equal(isValidBatchFitScoreInput({
  restaurantId,
  userProfile: { goals: [], preferences: [], allergies: [] },
  context: { weather: "cool", occasion: "birthday" },
}), true);
assert.equal(isValidBatchFitScoreInput({
  restaurantId,
  userProfile: { goals: [], preferences: [], allergies: [], unexpected: true },
}), false);

console.log("Dining profile validation tests passed.");
