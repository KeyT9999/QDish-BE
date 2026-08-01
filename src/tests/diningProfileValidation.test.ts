import assert from "node:assert/strict";
import {
  isValidBatchFitScoreInput,
  parseRecommendationRequest,
} from "../services/diningProfileValidation.js";

const restaurantId = "507f1f77bcf86cd799439011";

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
