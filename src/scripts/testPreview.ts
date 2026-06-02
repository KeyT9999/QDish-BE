import mongoose from "mongoose";
import dotenv from "dotenv";
import { Ingredient } from "../models/Ingredient.js";
import { NutritionService } from "../services/nutritionService.js";

dotenv.config();

const DEFAULT_URI = "mongodb://127.0.0.1:27017/nhahang";
const uri = process.env.MONGODB_URI || DEFAULT_URI;

async function runTest() {
  console.log("🧪 Starting Nutrition Calculation Engine Verification Test...");
  try {
    await mongoose.connect(uri);
    console.log("🔌 Connected to MongoDB.");

    // Fetch seeded ingredients
    const chicken = await Ingredient.findOne({ slug: "chicken-breast" });
    const soySauce = await Ingredient.findOne({ slug: "soy-sauce" });
    const egg = await Ingredient.findOne({ slug: "egg" });

    if (!chicken || !soySauce || !egg) {
      console.error("❌ Seeding data missing! Please run seed script first.");
      process.exit(1);
    }

    console.log(`📌 Found ingredients:`);
    console.log(`- ${chicken.name} (ID: ${chicken._id})`);
    console.log(`- ${soySauce.name} (ID: ${soySauce._id})`);
    console.log(`- ${egg.name} (ID: ${egg._id})`);

    // Build a mock recipe:
    // - 150g Chicken Breast
    // - 1 tbsp Soy Sauce (resolved to 15g)
    // - 1 piece Egg (resolved to 50g)
    const testRecipe = [
      {
        ingredientId: chicken._id.toString(),
        quantity: 150,
        unit: "g"
      },
      {
        ingredientId: soySauce._id.toString(),
        quantity: 1,
        unit: "tbsp"
      },
      {
        ingredientId: egg._id.toString(),
        quantity: 1,
        unit: "piece"
      }
    ];

    console.log("\n🧮 Running calculateNutrition engine on mock recipe...");
    const computed = await NutritionService.calculateNutrition(testRecipe, 1);

    console.log("\n📊 Computed Nutrition Results (Per Serving):");
    console.log(`- Calories: ${computed.calories} kcal (Expected: ~333 kcal)`);
    console.log(`- Protein: ${computed.protein}g (Expected: ~54.2g)`);
    console.log(`- Carbs (Carb): ${computed.carb}g (Expected: ~1.3g)`);
    console.log(`- Fat: ${computed.fat}g (Expected: ~11.0g)`);
    console.log(`- Fiber: ${computed.fiber}g`);
    console.log(`- Sugar: ${computed.sugar}g`);
    console.log(`- Sodium: ${computed.sodium}mg`);
    console.log(`- Badges / Attributes: ${JSON.stringify(computed.attributes)} (Expected: ["HIGH_PROTEIN", "LOW_SUGAR", "LOW_CALORIE"])`);
    console.log(`- Allergens: ${JSON.stringify(computed.allergens)} (Expected: ["soy", "gluten", "eggs"])`);
    console.log(`- Confidence Score: ${computed.nutritionConfidence} (Expected: close to 1.0)`);

    // Verify constraints
    if (
      computed.calories > 0 &&
      computed.protein > 0 &&
      computed.attributes.includes("HIGH_PROTEIN") &&
      computed.allergens.includes("soy") &&
      computed.allergens.includes("gluten") &&
      computed.allergens.includes("eggs")
    ) {
      console.log("\n✅ ENGINE CALCULATIONS PASSED VERIFICATION!");
    } else {
      console.log("\n❌ ENGINE CALCULATIONS FAILED VERIFICATION CONSTRAINT CHECK.");
    }

  } catch (error) {
    console.error("❌ Test run encountered error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB.");
  }
}

runTest();
