import { AttributeEngine } from "../engines/attributes/AttributeEngine.js";
import { ComputedNutrition } from "../services/nutritionService.js";
import { DishContext } from "../engines/attributes/attributeRules.js";

// Test cases representing realistic meal inputs

// Test case 1: Chicken Breast Bowl (Gym/Fitness context)
const chickenBowlNutrition: ComputedNutrition = {
  calories: 450,
  protein: 35,
  carb: 40,
  fat: 10,
  fiber: 4,
  sugar: 2,
  sodium: 400,
  attributes: [],
  allergens: [],
  nutritionConfidence: 0.95
};
const chickenBowlContext: DishContext = {
  servingCount: 1,
  ingredients: [
    { ingredientId: "1", name: "Ức gà", category: "protein", allergens: [] },
    { ingredientId: "2", name: "Gạo lứt", category: "tinh_bot", allergens: [] },
    { ingredientId: "3", name: "Bông cải xanh", category: "rau_cu", allergens: [] }
  ]
};

// Test case 2: Salad (Light/Vegetarian/Vegan context)
const saladNutrition: ComputedNutrition = {
  calories: 220,
  protein: 8,
  carb: 15,
  fat: 12,
  fiber: 5,
  sugar: 3,
  sodium: 150,
  attributes: [],
  allergens: [],
  nutritionConfidence: 0.99
};
const saladContext: DishContext = {
  servingCount: 1,
  ingredients: [
    { ingredientId: "4", name: "Xà lách", category: "rau_cu", allergens: [] },
    { ingredientId: "5", name: "Cà chua", category: "rau_cu", allergens: [] },
    { ingredientId: "6", name: "Dầu ô liu", category: "chat_beo", allergens: [] },
    { ingredientId: "7", name: "Đậu hũ", category: "protein", allergens: ["soy"] }
  ]
};

// Test case 3: BBQ Platter (Family/Sharing context)
const bbqPlatterNutrition: ComputedNutrition = {
  calories: 750,
  protein: 45,
  carb: 20,
  fat: 40,
  fiber: 1,
  sugar: 12,
  sodium: 900,
  attributes: [],
  allergens: [],
  nutritionConfidence: 0.90
};
const bbqPlatterContext: DishContext = {
  servingCount: 4,
  ingredients: [
    { ingredientId: "8", name: "Thịt heo", category: "protein", allergens: [] },
    { ingredientId: "9", name: "Thịt bò", category: "protein", allergens: [] },
    { ingredientId: "10", name: "Dầu ăn", category: "chat_beo", allergens: [] }
  ]
};

console.log("🏃 Running Attribute Engine Unit Tests...");

const cbAttrs = AttributeEngine.applyAllRules(chickenBowlNutrition, chickenBowlContext);
console.log("Chicken Breast Bowl Attributes:", cbAttrs);
const cbSuccess = cbAttrs.includes("HIGH_PROTEIN") && cbAttrs.includes("POST_WORKOUT") && cbAttrs.includes("OFFICE_LUNCH");
console.log(cbSuccess ? "✅ Chicken Bowl Test PASSED" : "❌ Chicken Bowl Test FAILED");

const saladAttrs = AttributeEngine.applyAllRules(saladNutrition, saladContext);
console.log("Salad Attributes:", saladAttrs);
const saladSuccess = saladAttrs.includes("VEGETARIAN") && saladAttrs.includes("VEGAN") && saladAttrs.includes("LIGHT_MEAL") && saladAttrs.includes("LOW_CALORIE") && saladAttrs.includes("REFRESHING");
console.log(saladSuccess ? "✅ Salad Test PASSED" : "❌ Salad Test FAILED");

const bbqAttrs = AttributeEngine.applyAllRules(bbqPlatterNutrition, bbqPlatterContext);
console.log("BBQ Platter Attributes:", bbqAttrs);
const bbqSuccess = bbqAttrs.includes("VERY_HIGH_PROTEIN") && bbqAttrs.includes("SOCIAL_SHARING") && bbqAttrs.includes("FAMILY_MEAL") && bbqAttrs.includes("HEAVY_MEAL") && bbqAttrs.includes("ENERGY_DENSE");
console.log(bbqSuccess ? "✅ BBQ Platter Test PASSED" : "❌ BBQ Platter Test FAILED");

if (cbSuccess && saladSuccess && bbqSuccess) {
  console.log("🎉 All Attribute Engine tests passed successfully!");
  process.exit(0);
} else {
  console.error("🚨 Some Attribute Engine tests failed.");
  process.exit(1);
}
