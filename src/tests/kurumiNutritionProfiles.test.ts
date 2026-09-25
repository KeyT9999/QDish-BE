import assert from "node:assert/strict";
import { kurumiDaNangMenuSnapshot } from "../scripts/kurumiDaNangMenuSnapshot.js";
import { normalizeKurumiMenuSections } from "../scripts/kurumiMenuSeedData.js";
import { buildKurumiRecipePlan } from "../scripts/kurumiRecipeSeedData.js";
import { getKurumiNutritionEstimate } from "../scripts/kurumiNutritionProfiles.js";

const { items } = normalizeKurumiMenuSections(kurumiDaNangMenuSnapshot.sections);
const plan = buildKurumiRecipePlan(items);
const requiredFields = [
  "caloriesPer100g",
  "proteinPer100g",
  "carbPer100g",
  "fatPer100g",
  "fiberPer100g",
  "sugarPer100g",
  "sodiumPer100g"
] as const;

for (const ingredient of plan.ingredients) {
  const estimate = getKurumiNutritionEstimate(ingredient.name);
  assert.ok(estimate, `missing nutrition estimate for ${ingredient.name}`);
  assert.ok(estimate.provenance.trim(), `missing estimate provenance for ${ingredient.name}`);
  for (const field of requiredFields) {
    assert.ok(Number.isFinite(estimate[field]), `${ingredient.name}.${field} must be numeric`);
    assert.ok(estimate[field] >= 0, `${ingredient.name}.${field} must not be negative`);
  }
}

const water = getKurumiNutritionEstimate("Nước lọc");
assert.equal(water?.caloriesPer100g, 0, "water is legitimately calorie-free");
assert.equal(water?.sodiumPer100g, 4, "tap-water reference retains its trace sodium");

const soda = getKurumiNutritionEstimate("Coke Zero (thành phẩm)");
assert.equal(soda?.caloriesPer100g, 0, "sugar-free soda can legitimately have zero calories");

const salt = getKurumiNutritionEstimate("Muối hồng Himalaya");
assert.equal(salt?.caloriesPer100g, 0);
assert.ok((salt?.sodiumPer100g ?? 0) > 30000, "salt must not be treated as a zero-sodium ingredient");

const tofu = getKurumiNutritionEstimate("Đậu hũ");
assert.ok((tofu?.proteinPer100g ?? 0) > 10, "tofu profile must contribute protein");

console.log(`✅ KURUMI nutrition profile tests passed (${plan.ingredients.length} ingredients)`);
