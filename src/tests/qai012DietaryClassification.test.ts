import assert from "node:assert/strict";

import { AttributeEngine } from "../engines/attributes/AttributeEngine.js";
import { Ingredient } from "../models/Ingredient.js";
import { NutritionService } from "../services/nutritionService.js";

const baseNutrition = {
  calories: 400,
  protein: 25,
  carb: 30,
  fat: 10,
  fiber: 6,
  sugar: 5,
  sodium: 100,
  attributes: [],
  allergens: [],
  nutritionConfidence: 1,
  completeness: 1,
  isComplete: true,
  missingIngredientCount: 0,
};

const numericAttributes = [
  "HIGH_PROTEIN",
  "VERY_HIGH_PROTEIN",
  "ENERGY_DENSE",
  "HEAVY_MEAL",
  "LIGHT_MEAL",
  "LOW_SUGAR",
  "LOW_CALORIE",
  "HIGH_FIBER",
  "LOW_FAT",
  "HIGH_CARB",
  "KETO_FRIENDLY",
  "POST_WORKOUT",
  "OFFICE_LUNCH",
  "QUICK_BITE",
  "LATE_NIGHT_FIT",
  "COMFORT_FOOD",
  "REFRESHING",
];

function attributesFor(
  nutritionOverrides: Partial<typeof baseNutrition> = {},
  contextOverrides: Record<string, unknown> = {},
) {
  return AttributeEngine.applyAllRules(
    { ...baseNutrition, ...nutritionOverrides },
    {
      servingCount: 1,
      ingredients: [],
      ...contextOverrides,
    } as any,
  );
}

// Missing recipe evidence must not become positive nutrition evidence.
const incompleteAttributes = attributesFor({
  calories: 0,
  protein: 0,
  fiber: 0,
  sugar: 0,
  fat: 0,
  completeness: 0,
  isComplete: false,
});
for (const attribute of numericAttributes) {
  assert.equal(incompleteAttributes.includes(attribute), false, `${attribute} requires reliable nutrition`);
}

// Explicit, complete zero remains meaningfully different from missing data.
assert.equal(attributesFor({ sugar: 0 }).includes("LOW_SUGAR"), true);
assert.equal(attributesFor({ sugar: undefined as never }).includes("LOW_SUGAR"), false);
assert.equal(attributesFor({ protein: undefined as never }).includes("HIGH_PROTEIN"), false);
assert.equal(attributesFor({ fiber: undefined as never }).includes("HIGH_FIBER"), false);
assert.equal(attributesFor({ calories: undefined as never }).includes("LOW_CALORIE"), false);
assert.equal(attributesFor({ fat: undefined as never }).includes("LOW_FAT"), false);

const originalFindById = Ingredient.findById;
const missingSugarIngredient = {
  _id: "missing-sugar",
  name: "Missing sugar fact",
  category: "test",
  isVerified: true,
  gramsPerUnit: 1,
  caloriesPer100g: 100,
  proteinPer100g: 10,
  carbPer100g: 10,
  fatPer100g: 2,
  fiberPer100g: 1,
  sodiumPer100g: 10,
  allergens: [],
  attributes: [],
};
const explicitZeroSugarIngredient = { ...missingSugarIngredient, _id: "explicit-zero-sugar", sugarPer100g: 0 };
(Ingredient.findById as any) = async (id: string) => {
  if (id === missingSugarIngredient._id) return missingSugarIngredient;
  if (id === explicitZeroSugarIngredient._id) return explicitZeroSugarIngredient;
  return null;
};
try {
  const missingSugarNutrition = await NutritionService.calculateNutrition(
    [{ ingredientId: missingSugarIngredient._id, quantity: 100, unit: "g" }],
    1,
  );
  assert.equal(missingSugarNutrition.isComplete, false);
  assert.equal(missingSugarNutrition.attributes.includes("LOW_SUGAR"), false);

  const explicitZeroSugarNutrition = await NutritionService.calculateNutrition(
    [{ ingredientId: explicitZeroSugarIngredient._id, quantity: 100, unit: "g" }],
    1,
  );
  assert.equal(explicitZeroSugarNutrition.isComplete, true);
  assert.equal(explicitZeroSugarNutrition.attributes.includes("LOW_SUGAR"), true);
} finally {
  (Ingredient.findById as any) = originalFindById;
}

assert.equal(attributesFor({ protein: 24.9 }).includes("HIGH_PROTEIN"), false);
assert.equal(attributesFor({ protein: 25 }).includes("HIGH_PROTEIN"), true);
assert.equal(attributesFor({ protein: 25.1 }).includes("HIGH_PROTEIN"), true);
assert.equal(attributesFor({ fiber: 5.9 }).includes("HIGH_FIBER"), false);
assert.equal(attributesFor({ fiber: 6 }).includes("HIGH_FIBER"), true);
assert.equal(attributesFor({ fiber: 6.1 }).includes("HIGH_FIBER"), true);
assert.equal(attributesFor({ sugar: 5 }).includes("LOW_SUGAR"), true);
assert.equal(attributesFor({ sugar: 5.1 }).includes("LOW_SUGAR"), false);
assert.equal(attributesFor({ calories: 0 }).includes("LOW_CALORIE"), false);
assert.equal(attributesFor({ calories: 399.9 }).includes("LOW_CALORIE"), true);
assert.equal(attributesFor({ calories: 400 }).includes("LOW_CALORIE"), true);
assert.equal(attributesFor({ calories: 400.1 }).includes("LOW_CALORIE"), false);

const explicitDietaryContext = {
  ingredients: [
    {
      ingredientId: "known",
      name: "Verified plant ingredient",
      category: "vegetable",
      allergens: [],
      attributes: ["VEGAN", "VEGETARIAN", "GLUTEN_FREE", "DAIRY_FREE"],
    },
  ],
};
const explicitDietaryAttributes = attributesFor({}, explicitDietaryContext);
for (const attribute of ["VEGAN", "VEGETARIAN", "GLUTEN_FREE", "DAIRY_FREE"]) {
  assert.equal(explicitDietaryAttributes.includes(attribute), true, `${attribute} accepts explicit evidence`);
}

const unknownCompositionAttributes = attributesFor({}, {
  ingredients: [{ ingredientId: "unknown", name: "House sauce", category: "sauce", allergens: [] }],
});
for (const attribute of ["VEGAN", "VEGETARIAN", "GLUTEN_FREE", "DAIRY_FREE"]) {
  assert.equal(unknownCompositionAttributes.includes(attribute), false, `${attribute} rejects unknown composition`);
}

const knownDairyConflictAttributes = attributesFor({}, {
  ingredients: [{
    ingredientId: "dairy",
    name: "Explicitly labelled ingredient",
    category: "test",
    allergens: [" DAIRY "],
    attributes: ["VEGAN", "VEGETARIAN", "GLUTEN_FREE", "DAIRY_FREE"],
  }],
});
assert.equal(knownDairyConflictAttributes.includes("VEGAN"), false);
assert.equal(knownDairyConflictAttributes.includes("DAIRY_FREE"), false);

const knownFishConflictAttributes = attributesFor({}, {
  ingredients: [{
    ingredientId: "fish",
    name: "Explicitly labelled ingredient",
    category: "test",
    allergens: ["FISH"],
    attributes: ["VEGAN", "VEGETARIAN", "GLUTEN_FREE", "DAIRY_FREE"],
  }],
});
assert.equal(knownFishConflictAttributes.includes("VEGAN"), false);
assert.equal(knownFishConflictAttributes.includes("VEGETARIAN"), false);

const knownGlutenConflictAttributes = attributesFor({}, {
  ingredients: [{
    ingredientId: "gluten",
    name: "Explicitly labelled ingredient",
    category: "test",
    allergens: ["gluten"],
    attributes: ["VEGAN", "VEGETARIAN", "GLUTEN_FREE", "DAIRY_FREE"],
  }],
});
assert.equal(knownGlutenConflictAttributes.includes("GLUTEN_FREE"), false);

const incompleteCompositionAttributes = attributesFor(
  { completeness: 0.5, isComplete: false, missingIngredientCount: 1 },
  explicitDietaryContext,
);
for (const attribute of ["VEGAN", "VEGETARIAN", "GLUTEN_FREE", "DAIRY_FREE"]) {
  assert.equal(incompleteCompositionAttributes.includes(attribute), false, `${attribute} requires complete composition`);
}

console.log("QAI-012 dietary classification tests passed");
