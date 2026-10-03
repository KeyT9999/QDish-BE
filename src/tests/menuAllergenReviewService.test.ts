import assert from "node:assert/strict";
import { resolveMenuAllergenReview } from "../services/menuAllergenReviewService.js";

const evidence = {
  method: "MANUAL",
  containsAllergens: [],
  mayContainAllergens: [],
  sourceType: "STAFF_ATTESTATION",
  sourceNote: "Đối chiếu công thức và nhãn của nhà cung cấp.",
  reviewerId: "staff-1",
  now: new Date("2026-10-03T10:00:00.000Z")
};

const noRecipe = { ingredients: [], allergenCoverageStatus: "UNKNOWN" as const, allergenUnverifiedIngredientCount: 0 };
const completeRecipe = {
  ingredients: [{ ingredientId: "ingredient-1" }],
  recipeAllergens: ["PEANUT", "GLUTEN"],
  allergenCoverageStatus: "COMPLETE" as const,
  allergenUnverifiedIngredientCount: 0,
  recipeIngredientsReviewed: true
};

assert.deepEqual(resolveMenuAllergenReview(noRecipe, evidence), {
  ok: true,
  value: {
    method: "MANUAL",
    containsAllergens: [],
    mayContainAllergens: [],
    sourceType: "STAFF_ATTESTATION",
    sourceNote: "Đối chiếu công thức và nhãn của nhà cung cấp.",
    reviewerId: "staff-1",
    reviewedAt: evidence.now
  }
}, "manual review supports restaurants without structured recipes and explicit reviewed-empty declarations");

assert.equal(resolveMenuAllergenReview(noRecipe, { ...evidence, method: "RECIPE", sourceType: "RESTAURANT_RECIPE" }).ok, false);
assert.equal(resolveMenuAllergenReview({ ...completeRecipe, allergenUnverifiedIngredientCount: 1 }, {
  ...evidence,
  method: "RECIPE",
  sourceType: "RESTAURANT_RECIPE"
}).ok, false, "one unknown ingredient prevents recipe review");
assert.equal(resolveMenuAllergenReview({ ...completeRecipe, recipeIngredientsReviewed: false }, {
  ...evidence,
  method: "RECIPE",
  sourceType: "RESTAURANT_RECIPE"
}).ok, false, "stale coverage cannot bypass checking evidence on each current recipe ingredient");

const recipeReview = resolveMenuAllergenReview(completeRecipe, {
  ...evidence,
  method: "RECIPE",
  containsAllergens: ["NUTS", "GLUTEN"],
  mayContainAllergens: ["SESAME"],
  sourceType: "RESTAURANT_RECIPE"
});
assert.equal(recipeReview.ok, true);
if (recipeReview.ok) {
  assert.deepEqual(recipeReview.value.containsAllergens, ["GLUTEN", "PEANUT", "TREE_NUTS"]);
  assert.deepEqual(recipeReview.value.mayContainAllergens, ["SESAME"]);
}

assert.equal(resolveMenuAllergenReview(completeRecipe, {
  ...evidence,
  method: "RECIPE",
  sourceType: "RESTAURANT_RECIPE",
  containsAllergens: ["PEANUT", "NUTS"]
}).ok, false, "aliases that duplicate a canonical allergen are rejected");
assert.deepEqual(resolveMenuAllergenReview(completeRecipe, {
  ...evidence,
  method: "RECIPE",
  sourceType: "RESTAURANT_RECIPE",
  containsAllergens: ["GLUTEN"],
  mayContainAllergens: []
}), { ok: false, reason: "RECIPE_ALLERGENS_MISSING" }, "recipe review cannot omit allergens confirmed on recipe ingredients");
assert.deepEqual(resolveMenuAllergenReview({ ...completeRecipe, recipeAllergens: undefined }, {
  ...evidence,
  method: "RECIPE",
  sourceType: "RESTAURANT_RECIPE",
  containsAllergens: ["PEANUT", "GLUTEN"],
  mayContainAllergens: []
}), { ok: false, reason: "RECIPE_ALLERGENS_MISSING" }, "recipe review fails closed if verified ingredient allergens cannot be derived");
assert.equal(resolveMenuAllergenReview(noRecipe, {
  ...evidence,
  containsAllergens: ["GLUTEN"],
  mayContainAllergens: ["GLUTEN"]
}).ok, false, "contains and may-contain lists must be unambiguous");
assert.equal(resolveMenuAllergenReview(noRecipe, { ...evidence, sourceNote: "  " }).ok, false);
assert.equal(resolveMenuAllergenReview(noRecipe, { ...evidence, sourceType: "CURATED_MENU_DESCRIPTION" }).ok, false);
assert.equal(resolveMenuAllergenReview(noRecipe, { ...evidence, containsAllergens: ["POLLEN"] }).ok, false);

console.log("menu allergen review service tests passed");
