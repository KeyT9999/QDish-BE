import "dotenv/config";
import mongoose, { Types } from "mongoose";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { DishNutritionProfile } from "../models/DishNutritionProfile.js";
import { Ingredient } from "../models/Ingredient.js";
import { MenuItem } from "../models/MenuItem.js";
import { Restaurant } from "../models/Restaurant.js";
import { User, UserRole } from "../models/User.js";
import { NutritionService } from "../services/nutritionService.js";
import { kurumiDaNangMenuSnapshot } from "./kurumiDaNangMenuSnapshot.js";
import {
  assertKurumiSeedTarget,
  indexExistingMenuMatches,
  menuItemKey,
  normalizeKurumiMenuSections,
  parseKurumiSeedOptions
} from "./kurumiMenuSeedData.js";
import { kurumiDemoIngredientSlug } from "./kurumiRecipeSeedData.js";
import { getKurumiNutritionEstimate } from "./kurumiNutritionProfiles.js";

const TARGET_USERNAME = "anvatcuti2";
const TARGET_RESTAURANT_NAME = "KURUMI - Healthy Vegan Food & Desserts";
const NUTRIENT_FIELDS = [
  "caloriesPer100g", "proteinPer100g", "carbPer100g", "fatPer100g", "fiberPer100g", "sugarPer100g", "sodiumPer100g"
] as const;
const MENU_BUSINESS_FIELDS = [
  "name", "description", "price", "category", "categoryId", "imageUrl", "available", "servingCount", "servingSizeGrams", "cookingMethod", "createdAt"
] as const;
let activeStage = "argument validation";

type NutrientField = typeof NUTRIENT_FIELDS[number];
type IngredientLean = {
  _id: Types.ObjectId;
  slug: string;
  name: string;
  category: string;
  defaultUnit: string;
  gramsPerUnit: number;
  restaurantId: Types.ObjectId | null;
  isVerified: boolean;
  source: string;
} & Partial<Record<NutrientField, number | null>> & Record<string, unknown>;
type MenuLean = {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  name: string;
  category: string;
  price: number;
  description?: string;
  ingredients?: Array<{ ingredientId: Types.ObjectId; quantity: number; unit: string; gramsResolved: number }>;
  servingCount?: number;
} & Record<string, unknown>;

function fail(message: string): never {
  throw new Error(message);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, current) => {
    if (current instanceof Types.ObjectId) return current.toString();
    if (current instanceof Date) return current.toISOString();
    return current;
  });
}

function selected(record: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, record[field]]));
}

function nutritionState(record: IngredientLean, values: Record<NutrientField, number>): "missing" | "complete" {
  const present = NUTRIENT_FIELDS.map((field) => typeof record[field] === "number");
  if (present.every((isPresent) => !isPresent)) return "missing";
  if (present.every(Boolean) && NUTRIENT_FIELDS.every((field) => record[field] === values[field])) return "complete";
  fail(`Nutrition data for ${record.name} is partially populated or differs from the approved demo profile; refusing to overwrite`);
}

function estimateDish(record: MenuLean, ingredientNamesById: ReadonlyMap<string, string>) {
  const totals = { calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 };
  for (const row of record.ingredients ?? []) {
    const name = ingredientNamesById.get(String(row.ingredientId));
    const profile = name ? getKurumiNutritionEstimate(name) : undefined;
    if (!profile) fail(`Nutrition profile missing for a recipe ingredient in ${record.name}`);
    const scale = (row.gramsResolved || row.quantity) / 100;
    totals.calories += profile.caloriesPer100g * scale;
    totals.protein += profile.proteinPer100g * scale;
    totals.carb += profile.carbPer100g * scale;
    totals.fat += profile.fatPer100g * scale;
    totals.fiber += profile.fiberPer100g * scale;
    totals.sugar += profile.sugarPer100g * scale;
    totals.sodium += profile.sodiumPer100g * scale;
  }
  const servings = typeof record.servingCount === "number" && record.servingCount > 0 ? record.servingCount : 1;
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number((value / servings).toFixed(1))]));
}

async function findTarget(username: string) {
  const users = await User.find({ username }).select("_id username role restaurantId").lean();
  if (users.length !== 1 || !users[0].restaurantId) fail("Expected one approved account linked to a restaurant");
  const user = users[0];
  if (![UserRole.RESTAURANT_ADMIN, UserRole.RESTAURANT_OWNER].includes(user.role as UserRole)) {
    fail("The approved account is not a restaurant owner/admin");
  }
  const restaurants = await Restaurant.find({ _id: user.restaurantId, username })
    .select("_id name username")
    .lean();
  if (restaurants.length !== 1 || restaurants[0].name !== TARGET_RESTAURANT_NAME) {
    fail("The account is not linked to the approved KURUMI demo restaurant");
  }
  return { user, restaurant: restaurants[0] };
}

async function applyNutrition(
  restaurantId: Types.ObjectId,
  ingredients: readonly IngredientLean[],
  ingredientProfiles: ReadonlyMap<string, Record<NutrientField, number>>,
  dishes: readonly MenuLean[]
): Promise<void> {
  for (const ingredient of ingredients) {
    const values = ingredientProfiles.get(String(ingredient._id));
    if (!values) fail("A target ingredient is missing its nutrient profile");
    if (nutritionState(ingredient, values) === "complete") continue;

    const onlyMissing = Object.fromEntries(NUTRIENT_FIELDS.map((field) => [field, { $in: [null] }]));
    const result = await Ingredient.updateOne(
      {
        _id: ingredient._id,
        restaurantId,
        source: "kurumi-demo-estimate",
        isVerified: false,
        ...onlyMissing
      },
      { $set: values },
      { runValidators: true }
    );
    if (result.matchedCount !== 1) fail("A demo ingredient changed during its safe nutrition update; stopped");
  }

  for (const dish of dishes) {
    const profile = await NutritionService.calculateDishNutrition(dish._id);
    if (!profile || !profile.isComplete || profile.missingIngredientCount !== 0) {
      fail(`Nutrition calculation did not complete for ${dish.name}`);
    }
  }
}

async function verifyApplied(
  restaurantId: Types.ObjectId,
  beforeMenus: readonly MenuLean[],
  officialItems: ReturnType<typeof normalizeKurumiMenuSections>["items"],
  profilesByIngredientId: ReadonlyMap<string, Record<NutrientField, number>>,
  ingredientIds: ReadonlySet<string>,
  beforeUnrelatedProfiles: readonly Record<string, unknown>[]
): Promise<{ calculated: number; nonZeroCalories: number }> {
  const afterMenus = await MenuItem.find({ restaurantId }).lean() as unknown as MenuLean[];
  if (afterMenus.length !== beforeMenus.length) fail("Post-update verification failed: menu record count changed");
  const beforeById = new Map(beforeMenus.map((row) => [String(row._id), row]));
  const afterById = new Map(afterMenus.map((row) => [String(row._id), row]));
  const officialBefore = indexExistingMenuMatches(beforeMenus, officialItems);
  const officialAfter = indexExistingMenuMatches(afterMenus, officialItems);
  if (officialBefore.size !== officialItems.length || officialAfter.size !== officialItems.length) {
    fail("Post-update verification failed: official KURUMI menu matching changed");
  }
  const officialIds = new Set<string>();
  let nonZeroCalories = 0;

  for (const item of officialItems) {
    const key = menuItemKey(item);
    const before = officialBefore.get(key);
    const after = officialAfter.get(key);
    if (!before || !after) fail("An official KURUMI dish disappeared during verification");
    officialIds.add(String(before._id));
    if (stableJson(selected(before, MENU_BUSINESS_FIELDS)) !== stableJson(selected(after, MENU_BUSINESS_FIELDS))) {
      fail(`Post-update verification failed: listing data changed for ${item.name}`);
    }
    const beforeRecipe = (before.ingredients ?? []).map(({ ingredientId, quantity, unit }) => ({ ingredientId: String(ingredientId), quantity, unit }));
    const afterRecipe = (after.ingredients ?? []).map(({ ingredientId, quantity, unit }) => ({ ingredientId: String(ingredientId), quantity, unit }));
    if (stableJson(beforeRecipe) !== stableJson(afterRecipe)) fail(`Post-update verification failed: recipe changed for ${item.name}`);
    if (!Array.isArray(after.ingredients) || after.ingredients.length === 0 || after.ingredients.some((row) => !ingredientIds.has(String(row.ingredientId)))) {
      fail(`Post-update verification failed: unexpected ingredient reference in ${item.name}`);
    }
    if (after.missingIngredientCount !== 0 || after.nutritionComplete !== true || after.nutritionCompleteness !== 1) {
      fail(`Post-update verification failed: incomplete nutrition cache for ${item.name}`);
    }
    for (const [menuField, ingredientField] of [
      ["calories", "caloriesPer100g"], ["protein", "proteinPer100g"], ["carbs", "carbPer100g"],
      ["fat", "fatPer100g"], ["fiber", "fiberPer100g"], ["sugar", "sugarPer100g"], ["sodium", "sodiumPer100g"]
    ] as const) {
      if (typeof after[menuField] !== "number" || !Number.isFinite(after[menuField])) {
        fail(`Post-update verification failed: ${menuField} cache is not numeric for ${item.name}`);
      }
      void ingredientField;
    }
    if ((after.calories as number) > 0) nonZeroCalories += 1;
  }

  for (const before of beforeMenus) {
    if (officialIds.has(String(before._id))) continue;
    const after = afterById.get(String(before._id));
    if (!after || stableJson(before) !== stableJson(after)) fail("Post-update verification failed: an unrelated menu record changed");
  }

  const calculatedProfiles = await DishNutritionProfile.find({ restaurantId, dishId: { $in: Array.from(officialIds) } })
    .sort({ dishId: 1, _id: 1 }).lean() as Array<Record<string, unknown> & { dishId: Types.ObjectId }>;
  const profileByDishId = new Map(calculatedProfiles.map((profile) => [String(profile.dishId), profile]));
  for (const id of officialIds) {
    const cached = afterById.get(id);
    const profile = profileByDishId.get(id);
    if (!cached || !profile || profile.isComplete !== true || profile.missingIngredientCount !== 0) {
      fail("Post-update verification failed: a QDish nutrition profile is missing or incomplete");
    }
    for (const [menuField, profileField] of [
      ["calories", "calories"], ["protein", "protein"], ["carbs", "carb"], ["fat", "fat"],
      ["fiber", "fiber"], ["sugar", "sugar"], ["sodium", "sodium"]
    ] as const) {
      if (cached[menuField] !== profile[profileField]) fail(`Post-update verification failed: ${menuField} cache diverges from its QDish profile`);
    }
  }

  const unrelatedProfiles = await DishNutritionProfile.find({ restaurantId, dishId: { $nin: Array.from(officialIds) } })
    .sort({ dishId: 1, _id: 1 }).lean();
  if (stableJson(unrelatedProfiles) !== stableJson(beforeUnrelatedProfiles)) {
    fail("Post-update verification failed: an unrelated nutrition profile changed");
  }

  const persistedIngredients = await Ingredient.find({ _id: { $in: Array.from(profilesByIngredientId.keys()) } }).lean() as unknown as IngredientLean[];
  if (persistedIngredients.length !== profilesByIngredientId.size) fail("A target ingredient disappeared during verification");
  for (const ingredient of persistedIngredients) {
    const profile = profilesByIngredientId.get(String(ingredient._id));
    if (!profile || nutritionState(ingredient, profile) !== "complete") fail(`Post-update verification failed for ${ingredient.name}`);
  }

  return { calculated: officialItems.length, nonZeroCalories };
}

function printHelp(): void {
  console.log([
    "Fill estimated nutrition profiles for existing KURUMI demo ingredients and recalculate its official menu cache.",
    "All ingredient records remain restaurant-local, unverified, and marked kurumi-demo-estimate.",
    "",
    "Usage:",
    "  npm run seed:kurumi-nutrition -- --username Anvatcuti2",
    "  npm run seed:kurumi-nutrition -- --username Anvatcuti2 --apply --confirm-db QDish --confirm-host <configured-host>",
    "",
    "Default mode is a read-only dry run. Apply is restricted to the approved QDish Atlas database."
  ].join("\n"));
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  activeStage = "argument validation";
  const options = parseKurumiSeedOptions(args);
  if (options.help) return printHelp();
  if (options.username !== TARGET_USERNAME) fail("This nutrition seed is restricted to the approved Anvatcuti2 demo account");

  const uri = process.env.MONGODB_URI;
  if (!uri) fail("MONGODB_URI must point to the approved QDish Atlas database");
  const target = assertKurumiSeedTarget(uri, options);

  try {
    activeStage = "MongoDB connection";
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    if (mongoose.connection.name !== "QDish") fail("Connected database does not match the approved QDish target");

    activeStage = "account and restaurant matching";
    const { restaurant } = await findTarget(TARGET_USERNAME);
    const restaurantId = restaurant._id as Types.ObjectId;
    const normalized = normalizeKurumiMenuSections(kurumiDaNangMenuSnapshot.sections);
    const definitions = buildDefinitions(normalized.items);

    activeStage = "ingredient profile and recipe preflight";
    const slugs = definitions.map((definition) => kurumiDemoIngredientSlug(String(restaurantId), definition.name));
    const ingredients = await Ingredient.find({ slug: { $in: slugs } }).lean() as unknown as IngredientLean[];
    const bySlug = new Map(ingredients.map((ingredient) => [ingredient.slug, ingredient]));
    if (ingredients.length !== definitions.length || bySlug.size !== definitions.length) {
      fail("Expected every approved recipe ingredient to have exactly one restaurant-local demo record");
    }
    const profilesByIngredientId = new Map<string, Record<NutrientField, number>>();
    const ingredientNamesById = new Map<string, string>();
    let alreadyComplete = 0;
    for (let index = 0; index < definitions.length; index += 1) {
      const definition = definitions[index];
      const ingredient = bySlug.get(slugs[index]);
      const estimate = getKurumiNutritionEstimate(definition.name);
      if (!ingredient || !estimate) fail("A demo ingredient identity or nutrient profile could not be resolved");
      if (
        ingredient.name !== definition.name || String(ingredient.restaurantId) !== String(restaurantId) ||
        ingredient.isVerified || ingredient.source !== "kurumi-demo-estimate" || ingredient.category !== definition.category
      ) fail(`A demo ingredient is not exclusively owned by the approved restaurant: ${definition.name}`);
      const values = Object.fromEntries(NUTRIENT_FIELDS.map((field) => [field, estimate[field]])) as Record<NutrientField, number>;
      if (nutritionState(ingredient, values) === "complete") alreadyComplete += 1;
      profilesByIngredientId.set(String(ingredient._id), values);
      ingredientNamesById.set(String(ingredient._id), ingredient.name);
    }

    const beforeMenus = await MenuItem.find({ restaurantId }).lean() as unknown as MenuLean[];
    const official = indexExistingMenuMatches(beforeMenus, normalized.items);
    if (official.size !== normalized.items.length) fail("The restaurant must contain every official KURUMI menu item exactly once");
    const dishes = normalized.items.map((item) => official.get(menuItemKey(item))!);
    const ingredientIds = new Set(ingredients.map((ingredient) => String(ingredient._id)));
    for (const dish of dishes) {
      if (!dish.ingredients?.length || dish.ingredients.some((row) => !ingredientIds.has(String(row.ingredientId)))) {
        fail(`An official recipe is empty or references a non-demo ingredient: ${dish.name}`);
      }
    }
    const officialIds = dishes.map((dish) => dish._id);
    const beforeUnrelatedProfiles = await DishNutritionProfile.find({ restaurantId, dishId: { $nin: officialIds } })
      .sort({ dishId: 1, _id: 1 }).lean() as unknown as Record<string, unknown>[];
    const projections = dishes.slice(0, 3).map((dish) => ({ dish: dish.name, estimate: estimateDish(dish, ingredientNamesById) }));

    if (!options.apply) {
      console.log("KURUMI nutrition backfill — DRY RUN (no database writes)");
      console.log(`Account verified: ${TARGET_USERNAME}; restaurant: ${TARGET_RESTAURANT_NAME}`);
      console.log(`Nutrient profiles: ${ingredients.length - alreadyComplete} to fill, ${alreadyComplete} already match; menu caches to recalculate: ${dishes.length}.`);
      console.log("Ingredient data remains unverified and is explicitly estimated; no ingredients, recipes, listings, allergens, or other accounts will be created/deleted.");
      console.log("Projected per-serving preview:");
      for (const row of projections) console.log(`  ${row.dish}: ${row.estimate.calories} kcal; P ${row.estimate.protein}g; C ${row.estimate.carb}g; F ${row.estimate.fat}g`);
      console.log(`Configured host: ${target.hostname}. To apply, rerun with --apply --confirm-db QDish --confirm-host ${target.hostname}.`);
      return;
    }

    if (target.hostname !== options.confirmHost) fail("MongoDB target changed before apply");
    activeStage = "applying estimated nutrition and refreshing dish caches";
    await applyNutrition(restaurantId, ingredients, profilesByIngredientId, dishes);
    activeStage = "post-apply verification";
    const result = await verifyApplied(
      restaurantId,
      beforeMenus,
      normalized.items,
      profilesByIngredientId,
      ingredientIds,
      beforeUnrelatedProfiles
    );
    console.log("KURUMI nutrition estimates applied and verified.");
    console.log(`Ingredient profiles filled: ${ingredients.length - alreadyComplete}; already matching: ${alreadyComplete}. Official menu caches recalculated: ${result.calculated}; nonzero-calorie items: ${result.nonZeroCalories}.`);
    console.log("All target recipes are complete with zero missing ingredients. Only estimated nutrient fields and derived nutrition/profile caches were updated; no menu listing, account, payment, subscription, table, category, or unrelated menu records changed.");
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

function buildDefinitions(items: ReturnType<typeof normalizeKurumiMenuSections>["items"]) {
  // Import inside the function avoids duplicating the vocabulary or its ingredient IDs.
  return buildKurumiRecipePlan(items).ingredients;
}

import { buildKurumiRecipePlan } from "./kurumiRecipeSeedData.js";

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch(() => {
    console.error(`KURUMI nutrition update stopped during ${activeStage}. Database details were suppressed; rerunning after review is safe.`);
    process.exitCode = 1;
  });
}
