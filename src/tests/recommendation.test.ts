import mongoose from "mongoose";
import { RecommendationEngine } from "../engines/recommendation/RecommendationEngine.js";
import { MenuItem } from "../models/MenuItem.js";
import { DishNutritionProfile } from "../models/DishNutritionProfile.js";
import { connectDB } from "../config/db.js";
import dotenv from "dotenv";

dotenv.config();

console.log("🏃 Running Recommendation Engine Unit Tests...");

async function runTests() {
  const DEFAULT_URI = "mongodb://127.0.0.1:27017/nhahang";
  const uri = process.env.MONGODB_URI || DEFAULT_URI;

  try {
    await mongoose.connect(uri);
    console.log("🔌 Connected to MongoDB.");

    // Find any restaurant in the DB to test with
    const testDish = await MenuItem.findOne().lean();
    if (!testDish) {
      console.warn("⚠️ No MenuItem found in database. Please seed or add menu items first to test recommendations.");
      process.exit(0);
    }

    const testRestaurantId = testDish.restaurantId.toString();
    console.log(`🔍 Found test restaurantId: ${testRestaurantId}`);

    // Create a mock UserDiningProfile with gym goals
    const mockGymUserProfile = {
      goals: ["MUSCLE_GAIN"],
      allergies: [],
      preferences: ["HIGH_PROTEIN"]
    };

    // Calculate recommendations
    const result = await RecommendationEngine.generateRecommendations(
      testRestaurantId,
      mockGymUserProfile,
      { postWorkout: true } // post workout context
    );

    console.log("--------------------------------------------------");
    console.log("✨ GENERATED RECOMMENDATIONS:");
    console.log(`Total bestForYou matches: ${result.bestForYou.length}`);
    console.log(`Total menu matches: ${result.fullMenu.length}`);
    console.log(`Total pairing suggestions: ${result.pairingSuggestions.length}`);

    if (result.bestForYou.length > 0) {
      console.log("\nTop 3 Recommended Items:");
      result.bestForYou.forEach((rec, i) => {
        console.log(`  ${i+1}. [Score: ${rec.fitScore}%] ${rec.dish.name}`);
        console.log(`     Reason: ${rec.reason}`);
        console.log(`     Context: ${rec.bestContextLabel}`);
      });
    }

    if (result.pairingSuggestions.length > 0) {
      console.log("\nSmart Meal Pairings:");
      result.pairingSuggestions.forEach((p, i) => {
        console.log(`  ${i+1}. Pair: ${p.mainDishName} + ${p.pairedDish.name}`);
        console.log(`     Reason: ${p.reason}`);
      });
    }
    console.log("--------------------------------------------------");

    console.log("✅ Recommendation Engine test completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("🚨 Recommendation Engine test failed:", error);
    process.exit(1);
  }
}

runTests();
