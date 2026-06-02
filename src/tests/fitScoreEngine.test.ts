import { FitScoreEngine } from "../engines/fitScore/FitScoreEngine.js";
import { ComputedNutrition } from "../services/nutritionService.js";

console.log("🏃 Running Fit Score Engine Unit Tests...");

// Test Case 1: Chicken Breast Bowl (Gym/fitness food)
const chickenBowl: ComputedNutrition = {
  calories: 450,
  protein: 35, // High protein
  carb: 40,
  fat: 10,
  fiber: 4,
  sugar: 2,
  sodium: 400,
  attributes: ["HIGH_PROTEIN", "LOW_SUGAR", "LOW_FAT", "POST_WORKOUT"],
  allergens: [],
  nutritionConfidence: 0.95
};

// 1. Gym Fit Score
const gymFitRes = FitScoreEngine.calculateFitScore(chickenBowl, chickenBowl.attributes, "gym_fit");
console.log("Chicken Bowl Gym Fit Score:", gymFitRes);
const gymFitPass = gymFitRes.score >= 80;
console.log(gymFitPass ? "✅ Gym Fit Test PASSED" : "❌ Gym Fit Test FAILED");

// 2. Keto Fit Score (Should be low because carbs are 40g)
const ketoFitRes = FitScoreEngine.calculateFitScore(chickenBowl, chickenBowl.attributes, "keto_fit");
console.log("Chicken Bowl Keto Fit Score:", ketoFitRes);
const ketoFitPass = ketoFitRes.score <= 35;
console.log(ketoFitPass ? "✅ Keto Fit Test PASSED" : "❌ Keto Fit Test FAILED");

// 3. Test context modifier: post-workout context should boost Gym Fit score by 1.3x
const workoutContextRes = FitScoreEngine.calculateFitScore(
  chickenBowl,
  chickenBowl.attributes,
  "gym_fit",
  undefined,
  { postWorkout: true }
);
console.log("Chicken Bowl Gym Fit Score with Post-Workout context:", workoutContextRes);
const expectedBoostScore = Math.min(100, Math.round(gymFitRes.score * 1.3));
const contextPass = workoutContextRes.score === expectedBoostScore;
console.log(contextPass ? "✅ Context Modifier Test PASSED" : "❌ Context Modifier Test FAILED");

// 4. Test allergen block: if user has soy allergy and chicken bowl has soy allergen, score should block
const allergenBowl: ComputedNutrition = {
  ...chickenBowl,
  allergens: ["soy"]
};
const allergenProfile = {
  goals: ["MUSCLE_GAIN"],
  allergies: ["SOY"], // Soy allergy matches bowl's soy allergen
  preferences: []
};

const allergenRes = FitScoreEngine.calculateFitScore(
  allergenBowl,
  allergenBowl.attributes,
  "gym_fit",
  allergenProfile
);
console.log("Chicken Bowl score for Soy-Allergic User:", allergenRes);
const allergenPass = allergenRes.score === 0 && allergenRes.blocked && allergenRes.blockReason === "allergen";
console.log(allergenPass ? "✅ Allergen Block Test PASSED" : "❌ Allergen Block Test FAILED");

if (gymFitPass && ketoFitPass && contextPass && allergenPass) {
  console.log("🎉 All Fit Score Engine tests passed successfully!");
  process.exit(0);
} else {
  console.error("🚨 Some Fit Score Engine tests failed.");
  process.exit(1);
}
