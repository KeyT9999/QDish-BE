import assert from "node:assert/strict";
import { kurumiDaNangMenuSnapshot } from "../scripts/kurumiDaNangMenuSnapshot.js";
import { normalizeKurumiMenuSections } from "../scripts/kurumiMenuSeedData.js";
import {
  buildKurumiRecipePlan,
  buildKurumiRecipePatch,
  isRefreshableKurumiRecipe,
  parseKurumiRecipeSeedOptions,
  type KurumiRecipePlan
} from "../scripts/kurumiRecipeSeedData.js";

const { items } = normalizeKurumiMenuSections(kurumiDaNangMenuSnapshot.sections);
const plan: KurumiRecipePlan = buildKurumiRecipePlan(items);

assert.equal(plan.recipes.length, 181, "every official menu item must receive a recipe");
assert.ok(plan.recipes.filter((recipe) => recipe.basis === "menu-description").length > 80);
assert.ok(plan.recipes.some((recipe) => recipe.basis === "menu-name-inference"));
assert.ok(plan.ingredients.length > 30, "the plan should contain reusable ingredient definitions");

const recipesByName = new Map(plan.recipes.map((recipe) => [recipe.name, recipe]));
const pancake = recipesByName.get("Bánh Kếp Yến Mạch Dừa");
assert.ok(pancake);
for (const expectedName of ["Yến mạch", "Sữa dừa", "Chuối"]) {
  assert.ok(pancake.ingredients.some((entry) => entry.name === expectedName));
}

const tea = recipesByName.get("Trà Gừng Hoa Cúc");
assert.ok(tea);
assert.ok(tea.ingredients.some((entry) => /gừng|hoa cúc/i.test(entry.name)));
assert.ok(tea.ingredients.some((entry) => /nước nóng/i.test(entry.name)));
assert.equal(tea.cookingMethod, "boil");

const coconutCoffee = recipesByName.get("Cà Phê Dừa");
assert.ok(coconutCoffee);
assert.ok(coconutCoffee.ingredients.some((entry) => entry.name === "Sữa dừa"));
assert.equal(coconutCoffee.ingredients.some((entry) => entry.name === "Thơm"), false);

const wholemealToast = recipesByName.get("Bánh Mì Nướng Nguyên Cám");
assert.ok(wholemealToast);
assert.ok(wholemealToast.ingredients.some((entry) => entry.name === "Bánh mì nguyên cám"));
assert.equal(wholemealToast.ingredients.some((entry) => entry.name === "Cam"), false);

const soup = recipesByName.get("Súp Miso");
assert.ok(soup);
assert.equal(soup.cookingMethod, "boil");
assert.ok(soup.ingredients.some((entry) => entry.name === "Nước dùng rau củ"));

const beer = recipesByName.get("Bia Ngũ Hành - Kim");
assert.ok(beer);
assert.equal(beer.ingredients.length, 1);
assert.equal(beer.ingredients[0].name, "Bia thành phẩm: Bia Ngũ Hành - Kim");
assert.equal(beer.cookingMethod, "raw");

assert.equal(recipesByName.get("Coke Zero")?.cookingMethod, "raw");
assert.equal(recipesByName.get("Bánh Chuối")?.cookingMethod, "bake");
assert.ok(recipesByName.get("Sinh Tố Xoài Dâu Tây")?.ingredients.some((entry) => entry.name === "Nước dừa"));
assert.ok(recipesByName.get("Sô Cô La Sữa Thuần Chay")?.ingredients.some((entry) => entry.name === "Sô-cô-la thuần chay"));

const bannedAnimalTerms = /\b(chicken|beef|pork|fish|salmon|shrimp|egg|milk|butter|cheese)\b|thịt gà|thịt bò|thịt heo|nước mắm|trứng gà|sữa bò|bơ lạt|phô mai sữa/i;
for (const ingredient of plan.ingredients) {
  assert.equal(bannedAnimalTerms.test(ingredient.name), false, `animal-derived ingredient: ${ingredient.name}`);
  assert.equal(ingredient.isVerified, false, "demo ingredients must never enter the verified catalog");
  assert.ok(ingredient.source.includes("kurumi-demo-estimate"));
  assert.equal("caloriesPer100g" in ingredient, false, "do not invent nutrient facts");
}

const supportedMethods = new Set(["raw", "boil", "steam", "stir_fry", "deep_fry", "grill", "bake", "braise"]);
for (const recipe of plan.recipes) {
  assert.equal(recipe.servingCount, 1);
  assert.ok(recipe.ingredients.length > 0, `${recipe.name} must have ingredients`);
  assert.ok(supportedMethods.has(recipe.cookingMethod), `${recipe.name} has unsupported method`);
  assert.ok(recipe.servingSizeGrams >= 1 && recipe.servingSizeGrams <= 1500);
  for (const row of recipe.ingredients) {
    assert.ok(row.quantity > 0);
    assert.ok(row.gramsResolved > 0);
    assert.equal(row.gramsResolved, Math.round(row.quantity * row.gramsPerUnit));
  }
}

const onlyRecipeFields = buildKurumiRecipePatch(plan.recipes[0], new Map(
  plan.ingredients.map((ingredient) => [ingredient.name, "ingredient-id"])
));

const refreshOptions = parseKurumiRecipeSeedOptions(["--username", "Anvatcuti2", "--refresh-demo"]);
assert.equal(refreshOptions.refreshDemo, true);
assert.equal(refreshOptions.apply, false, "refresh preview stays read-only until --apply is supplied");
assert.throws(
  () => parseKurumiRecipeSeedOptions(["--username", "Anvatcuti2", "--refresh-demo", "--refresh-demo"]),
  /duplicate/i
);

const demoRows = [{ ingredientId: "demo-1" }, { ingredientId: "demo-2" }];
const demoIngredients = new Map([
  ["demo-1", { restaurantId: "restaurant-1", isVerified: false, source: "kurumi-demo-estimate", hasNutritionFacts: false }],
  ["demo-2", { restaurantId: "restaurant-1", isVerified: false, source: "kurumi-demo-estimate", hasNutritionFacts: false }]
]);
assert.equal(isRefreshableKurumiRecipe(demoRows, demoIngredients, "restaurant-1"), true);
assert.equal(isRefreshableKurumiRecipe(demoRows, demoIngredients, "restaurant-2"), false);
assert.equal(isRefreshableKurumiRecipe([], demoIngredients, "restaurant-1"), false);
assert.equal(isRefreshableKurumiRecipe(demoRows, new Map([
  ["demo-1", demoIngredients.get("demo-1")!],
  ["demo-2", { ...demoIngredients.get("demo-2")!, hasNutritionFacts: true }]
]), "restaurant-1"), false);

assert.deepEqual(Object.keys(onlyRecipeFields).sort(), [
  "cookingMethod", "ingredients", "servingCount", "servingSizeGrams"
]);

console.log("✅ KURUMI recipe seed data tests passed");
