import "dotenv/config";
import mongoose, { Types } from "mongoose";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Category } from "../models/Category.js";
import { Ingredient } from "../models/Ingredient.js";
import { MenuItem } from "../models/MenuItem.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { Table } from "../models/Table.js";
import { User, UserRole } from "../models/User.js";
import { kurumiDaNangMenuSnapshot } from "./kurumiDaNangMenuSnapshot.js";
import {
  assertKurumiSeedTarget,
  indexExistingMenuMatches,
  menuItemKey,
  normalizeKurumiMenuSections,
  type KurumiMenuItem
} from "./kurumiMenuSeedData.js";
import {
  buildKurumiRecipePatch,
  buildKurumiRecipePlan,
  isRefreshableKurumiRecipe,
  kurumiDemoIngredientSlug,
  parseKurumiRecipeSeedOptions,
  type KurumiRecipeSeedOptions,
  type KurumiRecipeIngredientDefinition,
  type KurumiRecipeSuggestion
} from "./kurumiRecipeSeedData.js";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/nhahang";
const TARGET_USERNAME = "anvatcuti2";
const TARGET_RESTAURANT_NAME = "KURUMI - Healthy Vegan Food & Desserts";
const PROTECTED_MENU_FIELDS = [
  "name", "description", "price", "category", "categoryId", "imageUrl", "available",
  "calories", "protein", "carbs", "fat", "fiber", "sugar", "sodium", "confidenceScore",
  "nutritionCompleteness", "nutritionComplete", "missingIngredientCount", "allergens", "foodAttributes"
] as const;
const NUTRIENT_FIELDS = [
  "caloriesPer100g", "proteinPer100g", "carbPer100g", "fatPer100g", "fiberPer100g", "sugarPer100g", "sodiumPer100g"
] as const;
let activeStage = "argument validation";

interface MenuRecord {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  name: string;
  category: string;
  price: number;
  description?: string;
  categoryId?: Types.ObjectId;
  imageUrl?: string;
  available?: boolean;
  ingredients?: Array<{ ingredientId: Types.ObjectId; quantity: number; unit: string; gramsResolved: number }>;
  servingCount?: number;
  servingSizeGrams?: number;
  cookingMethod?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  confidenceScore?: number;
  nutritionCompleteness?: number;
  nutritionComplete?: boolean;
  missingIngredientCount?: number;
  allergens?: string[];
  foodAttributes?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

interface IngredientRecord {
  _id: Types.ObjectId;
  slug: string;
  name: string;
  category: string;
  defaultUnit: string;
  gramsPerUnit: number;
  restaurantId: Types.ObjectId | null;
  isVerified: boolean;
  source: string;
  [key: string]: unknown;
}

interface PendingRecipeUpdate {
  menuItem: KurumiMenuItem;
  record: MenuRecord;
  recipe: KurumiRecipeSuggestion;
  refreshDemo: boolean;
}

interface DemoIngredientCategoryUpdate {
  id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  name: string;
  previousCategory: string;
  category: string;
}

function printHelp(): void {
  console.log([
    "Seed estimated, one-serving vegan demo recipes for the official KURUMI menu.",
    "Ingredient names follow KURUMI's public menu where available; all quantities are estimates.",
    "The script does not invent nutrition or allergen facts and preserves recipes already entered.",
    "",
    "Usage:",
    "  npm run seed:kurumi-recipes -- --username Anvatcuti2",
    "  npm run seed:kurumi-recipes -- --username Anvatcuti2 --refresh-demo",
    "  npm run seed:kurumi-recipes -- --username Anvatcuti2 --apply --confirm-db QDish --confirm-host <configured-host>",
    "  Add --refresh-demo to update only recipes already composed entirely of this script's unverified demo ingredients.",
    "",
    "Default mode is a read-only dry run. Apply only targets the approved QDish Atlas database."
  ].join("\n"));
}

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

function selectedMenuFields(record: MenuRecord, fields: readonly string[]): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  for (const field of fields) {
    const value = (record as unknown as Record<string, unknown>)[field];
    selected[field] = value instanceof Types.ObjectId ? value.toString() : value;
  }
  return selected;
}

function emptyRecipe(record: MenuRecord): boolean {
  return !Array.isArray(record.ingredients) || record.ingredients.length === 0;
}

function uniqueOwnerIds(ids: Array<Types.ObjectId | null | undefined>): Types.ObjectId[] {
  return ids.filter((id): id is Types.ObjectId => Boolean(id))
    .filter((id, index, all) => all.findIndex((other) => String(other) === String(id)) === index);
}

async function findTargetAccount(username: string) {
  const users = await User.find({ username }).select(
    "_id username role restaurantId isActive email phone fullName name"
  ).lean();
  if (users.length !== 1) fail("Expected exactly one account matching --username");
  const user = users[0];
  if (!user.restaurantId) fail("The account is not linked to a restaurant");

  const restaurants = await Restaurant.find({ _id: user.restaurantId, username })
    .select("_id name username ownerId ownerName email address phone status active")
    .lean();
  if (restaurants.length !== 1) fail("The account must link to exactly one restaurant with the same username");
  if (restaurants[0].name !== TARGET_RESTAURANT_NAME) fail("The linked restaurant is not the approved KURUMI demo restaurant");
  if (![UserRole.RESTAURANT_ADMIN, UserRole.RESTAURANT_OWNER].includes(user.role as UserRole)) {
    fail("The linked account is not a restaurant owner/admin account");
  }
  return { user, restaurant: restaurants[0] };
}

async function readProtectedState(
  userId: Types.ObjectId,
  restaurantId: Types.ObjectId,
  subscriptionOwnerIds: readonly Types.ObjectId[]
) {
  const [user, restaurant, subscriptions, tables, categories] = await Promise.all([
    User.findById(userId).select("_id username role restaurantId isActive email phone fullName name").lean(),
    Restaurant.findById(restaurantId).select(
      "_id username name address phone ownerId ownerName email bankAccount bankName bankAccountNumber bankAccountHolder bankQrImageUrl bankQrPublicId paymentSettingsUpdatedByOwnerId paymentSettingsUpdatedAt status active"
    ).lean(),
    Subscription.find({ ownerId: { $in: subscriptionOwnerIds } })
      .select("ownerId planId planCode status billingCycle amount startedAt expiresAt paymentOrderCode payosPaymentLinkId lastWarningLevel")
      .sort({ ownerId: 1, _id: 1 }).lean(),
    Table.find({ restaurantId }).select("_id code isActive status activeSessionId currentSessionCode updatedAt")
      .sort({ _id: 1 }).lean(),
    Category.find({ restaurantId }).select("_id name updatedAt").sort({ _id: 1 }).lean()
  ]);
  return { user, restaurant, subscriptions, tables, categories };
}

async function readMenuRecords(restaurantId: Types.ObjectId): Promise<MenuRecord[]> {
  return await MenuItem.find({ restaurantId }).select(
    "_id restaurantId name description price category categoryId imageUrl available ingredients servingCount servingSizeGrams cookingMethod calories protein carbs fat fiber sugar sodium confidenceScore nutritionCompleteness nutritionComplete missingIngredientCount allergens foodAttributes createdAt updatedAt"
  ).lean() as unknown as MenuRecord[];
}

async function findRecipesToSeed(
  menuItems: readonly KurumiMenuItem[],
  records: readonly MenuRecord[],
  recipes: readonly KurumiRecipeSuggestion[],
  restaurantId: Types.ObjectId,
  refreshDemo: boolean
): Promise<PendingRecipeUpdate[]> {
  const matches = indexExistingMenuMatches(records, menuItems);
  if (matches.size !== menuItems.length) fail("The target restaurant must contain every official KURUMI menu item exactly once");
  const recipesByKey = new Map(recipes.map((recipe) => [menuItemKey(recipe), recipe]));
  const matchedRecords = menuItems.map((menuItem) => {
    const record = matches.get(menuItemKey(menuItem));
    const recipe = recipesByKey.get(menuItemKey(menuItem));
    if (!record || !recipe) fail("An official KURUMI menu item could not be paired with its recipe");
    return { menuItem, record, recipe };
  });

  const nonEmptyRecords = matchedRecords.filter(({ record }) => !emptyRecipe(record));
  const demoOrigins = new Map<string, {
    restaurantId: string | null;
    isVerified: boolean;
    source: string;
    hasNutritionFacts: boolean;
  }>();
  if (refreshDemo && nonEmptyRecords.length > 0) {
    const ingredientIds = Array.from(new Set(nonEmptyRecords.flatMap(({ record }) =>
      (record.ingredients ?? []).map((row) => String(row.ingredientId))
    )));
    const ingredients = await Ingredient.find({ _id: { $in: ingredientIds } })
      .select("_id restaurantId isVerified source caloriesPer100g proteinPer100g carbPer100g fatPer100g fiberPer100g sugarPer100g sodiumPer100g")
      .lean() as unknown as IngredientRecord[];
    for (const ingredient of ingredients) {
      demoOrigins.set(String(ingredient._id), {
        restaurantId: ingredient.restaurantId ? String(ingredient.restaurantId) : null,
        isVerified: ingredient.isVerified,
        source: ingredient.source,
        hasNutritionFacts: NUTRIENT_FIELDS.some((field) => typeof ingredient[field] === "number")
      });
    }
  }

  const pending: PendingRecipeUpdate[] = [];
  for (const { menuItem, record, recipe } of matchedRecords) {
    if (emptyRecipe(record)) {
      pending.push({ menuItem, record, recipe, refreshDemo: false });
    } else if (refreshDemo && isRefreshableKurumiRecipe(record.ingredients ?? [], demoOrigins, String(restaurantId))) {
      pending.push({ menuItem, record, recipe, refreshDemo: true });
    }
  }
  return pending;
}

function definitionsForPendingRecipes(
  pending: readonly PendingRecipeUpdate[],
  allDefinitions: readonly KurumiRecipeIngredientDefinition[]
): KurumiRecipeIngredientDefinition[] {
  const neededNames = new Set(pending.flatMap(({ recipe }) => recipe.ingredients.map((ingredient) => ingredient.name)));
  const definitions = allDefinitions.filter((definition) => neededNames.has(definition.name));
  if (definitions.length !== neededNames.size) fail("A recipe ingredient definition is missing");
  return definitions;
}

function assertDemoIngredient(
  record: IngredientRecord,
  definition: KurumiRecipeIngredientDefinition,
  restaurantId: Types.ObjectId,
  allowCategoryMigration = false
): void {
  if (
    String(record.restaurantId) !== String(restaurantId) ||
    record.isVerified ||
    record.source !== "kurumi-demo-estimate" ||
    record.name !== definition.name ||
    (!allowCategoryMigration && record.category !== definition.category) ||
    record.defaultUnit !== definition.defaultUnit ||
    record.gramsPerUnit !== definition.gramsPerUnit ||
    NUTRIENT_FIELDS.some((field) => typeof record[field] === "number")
  ) {
    fail("A deterministic demo ingredient key is already owned by conflicting or verified data; refusing to write");
  }
}

async function resolveDemoIngredients(
  restaurantId: Types.ObjectId,
  definitions: readonly KurumiRecipeIngredientDefinition[]
): Promise<{
  idsByName: Map<string, Types.ObjectId>;
  toCreate: KurumiRecipeIngredientDefinition[];
  toUpdateCategory: DemoIngredientCategoryUpdate[];
}> {
  const keys = definitions.map((definition) => ({
    definition,
    slug: kurumiDemoIngredientSlug(String(restaurantId), definition.name)
  }));
  const existing = await Ingredient.find({ slug: { $in: keys.map((key) => key.slug) } })
    .select("_id slug name category defaultUnit gramsPerUnit restaurantId isVerified source caloriesPer100g proteinPer100g carbPer100g fatPer100g fiberPer100g sugarPer100g sodiumPer100g")
    .lean() as unknown as IngredientRecord[];
  const existingBySlug = new Map<string, IngredientRecord>();
  for (const record of existing) {
    if (existingBySlug.has(record.slug)) fail("Duplicate demo ingredient slug detected; refusing to write");
    existingBySlug.set(record.slug, record);
  }

  const idsByName = new Map<string, Types.ObjectId>();
  const toCreate: KurumiRecipeIngredientDefinition[] = [];
  const toUpdateCategory: DemoIngredientCategoryUpdate[] = [];
  for (const { definition, slug } of keys) {
    const record = existingBySlug.get(slug);
    if (!record) {
      toCreate.push(definition);
      continue;
    }
    assertDemoIngredient(record, definition, restaurantId, true);
    idsByName.set(definition.name, record._id);
    if (record.category !== definition.category) {
      toUpdateCategory.push({
        id: record._id,
        restaurantId,
        name: definition.name,
        previousCategory: record.category,
        category: definition.category
      });
    }
  }
  return { idsByName, toCreate, toUpdateCategory };
}

function printDryRun(
  username: string,
  currentMenuCount: number,
  currentTableCount: number,
  pending: readonly PendingRecipeUpdate[],
  allRecipes: readonly KurumiRecipeSuggestion[],
  toCreate: readonly KurumiRecipeIngredientDefinition[],
  toReuse: number,
  toUpdateCategory: readonly DemoIngredientCategoryUpdate[],
  refreshDemo: boolean
): void {
  const existingPreserved = allRecipes.length - pending.length;
  const emptyToSeed = pending.filter((row) => !row.refreshDemo).length;
  const demoToRefresh = pending.filter((row) => row.refreshDemo).length;
  console.log("KURUMI recipe seed — DRY RUN (no database writes)");
  console.log(`Account verified: ${username}; restaurant: ${TARGET_RESTAURANT_NAME}`);
  console.log(`Official items: ${allRecipes.length}; existing recipes preserved: ${existingPreserved}; empty recipes to seed: ${emptyToSeed}; script-generated recipes to refresh: ${demoToRefresh}`);
  console.log(`Recipe evidence: ${allRecipes.filter((recipe) => recipe.basis === "menu-description").length} use described ingredients; ${allRecipes.filter((recipe) => recipe.basis === "menu-name-inference").length} inferred from item/category.`);
  console.log(`Restaurant-scoped demo ingredients: ${toCreate.length} create, ${toReuse} reuse, ${toUpdateCategory.length} category corrections; all unverified and without nutrient facts.`);
  console.log(`Current menu records: ${currentMenuCount}; tables preserved: ${currentTableCount}; nutrition/allergen cache writes: 0; deletions: 0.`);
  console.log(`To apply, rerun with --apply${refreshDemo ? " --refresh-demo" : ""} --confirm-db QDish --confirm-host <configured-host>.`);
}

function assertSameRecipe(actual: MenuRecord, expected: ReturnType<typeof buildKurumiRecipePatch>): void {
  const actualRows = (actual.ingredients ?? []).map((row) => ({
    ingredientId: String(row.ingredientId), quantity: row.quantity, unit: row.unit, gramsResolved: row.gramsResolved
  }));
  const expectedRows = expected.ingredients.map((row) => ({
    ingredientId: String(row.ingredientId), quantity: row.quantity, unit: row.unit, gramsResolved: row.gramsResolved
  }));
  if (
    stableJson(actualRows) !== stableJson(expectedRows) ||
    actual.servingCount !== expected.servingCount ||
    actual.servingSizeGrams !== expected.servingSizeGrams ||
    actual.cookingMethod !== expected.cookingMethod
  ) fail("Post-seed recipe verification failed");
}

async function verifyAfterApply(
  userId: Types.ObjectId,
  restaurantId: Types.ObjectId,
  subscriptionOwnerIds: readonly Types.ObjectId[],
  beforeProtectedState: Awaited<ReturnType<typeof readProtectedState>>,
  beforeMenu: readonly MenuRecord[],
  officialItems: readonly KurumiMenuItem[],
  pending: readonly PendingRecipeUpdate[],
  idsByName: ReadonlyMap<string, Types.ObjectId>,
  definitions: readonly KurumiRecipeIngredientDefinition[]
): Promise<void> {
  const [protectedAfter, menuAfter] = await Promise.all([
    readProtectedState(userId, restaurantId, subscriptionOwnerIds),
    readMenuRecords(restaurantId)
  ]);
  if (stableJson(protectedAfter) !== stableJson(beforeProtectedState)) {
    fail("Post-seed verification failed: account, restaurant settings, subscriptions, tables, or categories changed");
  }
  if (menuAfter.length !== beforeMenu.length) fail("Post-seed verification failed: menu record count changed");

  const afterById = new Map(menuAfter.map((record) => [String(record._id), record]));
  const pendingById = new Map(pending.map((row) => [String(row.record._id), row]));
  const officialKeys = new Set(officialItems.map(menuItemKey));
  const officialBefore = indexExistingMenuMatches(beforeMenu, officialItems);
  const officialAfter = indexExistingMenuMatches(menuAfter, officialItems);
  if (officialAfter.size !== officialItems.length) fail("Post-seed verification failed: official menu item set changed");

  for (const menuItem of officialItems) {
    const before = officialBefore.get(menuItemKey(menuItem));
    const after = officialAfter.get(menuItemKey(menuItem));
    if (!before || !after) fail("Post-seed official menu item could not be verified");
    if (stableJson(selectedMenuFields(after, PROTECTED_MENU_FIELDS)) !== stableJson(selectedMenuFields(before, PROTECTED_MENU_FIELDS))) {
      fail("Post-seed verification failed: a menu listing or nutrition/allergen field changed");
    }
    const update = pendingById.get(String(before._id));
    if (update) {
      const patch = buildKurumiRecipePatch(update.recipe, idsByName);
      assertSameRecipe(after, patch);
    } else if (stableJson(before.ingredients) !== stableJson(after.ingredients) ||
      before.servingCount !== after.servingCount || before.servingSizeGrams !== after.servingSizeGrams ||
      before.cookingMethod !== after.cookingMethod || stableJson(before.updatedAt) !== stableJson(after.updatedAt)) {
      fail("Post-seed verification failed: an existing recipe was changed");
    }
  }

  const legacyBefore = beforeMenu.filter((record) => !officialKeys.has(menuItemKey(record)));
  for (const record of legacyBefore) {
    const after = afterById.get(String(record._id));
    if (!after || stableJson(record) !== stableJson(after)) fail("Post-seed verification failed: an unrelated menu record changed");
  }

  const persistedIngredients = await Ingredient.find({
    slug: { $in: definitions.map((definition) => kurumiDemoIngredientSlug(String(restaurantId), definition.name)) }
  }).select("_id slug name category defaultUnit gramsPerUnit restaurantId isVerified source caloriesPer100g proteinPer100g carbPer100g fatPer100g fiberPer100g sugarPer100g sodiumPer100g").lean() as unknown as IngredientRecord[];
  const bySlug = new Map(persistedIngredients.map((ingredient) => [ingredient.slug, ingredient]));
  for (const definition of definitions) {
    const record = bySlug.get(kurumiDemoIngredientSlug(String(restaurantId), definition.name));
    if (!record) fail("Post-seed demo ingredient is missing");
    assertDemoIngredient(record, definition, restaurantId);
  }
}

async function applyRecipes(
  restaurantId: Types.ObjectId,
  pending: readonly PendingRecipeUpdate[],
  ingredientResolution: Awaited<ReturnType<typeof resolveDemoIngredients>>,
  definitions: readonly KurumiRecipeIngredientDefinition[]
): Promise<Map<string, Types.ObjectId>> {
  const idsByName = new Map(ingredientResolution.idsByName);
  for (const update of ingredientResolution.toUpdateCategory) {
    const missingFacts = Object.fromEntries(NUTRIENT_FIELDS.map((field) => [field, { $exists: false }]));
    const result = await Ingredient.updateOne(
      {
        _id: update.id,
        restaurantId,
        source: "kurumi-demo-estimate",
        isVerified: false,
        category: update.previousCategory,
        ...missingFacts
      },
      { $set: { category: update.category } },
      { runValidators: true }
    );
    if (result.matchedCount !== 1) fail("Demo ingredient changed during safe category correction; stopped");
  }
  for (const definition of ingredientResolution.toCreate) {
    const ingredient = await Ingredient.create({
      ...definition,
      slug: kurumiDemoIngredientSlug(String(restaurantId), definition.name),
      restaurantId,
      allergens: [],
      attributes: [],
      isActive: true
    });
    idsByName.set(definition.name, ingredient._id);
  }
  if (idsByName.size !== definitions.length) fail("Demo ingredient mapping is incomplete; stopped before applying recipes");

  for (const { record, recipe, refreshDemo } of pending) {
    const updateFilter = refreshDemo
      ? {
          _id: record._id,
          restaurantId,
          ingredients: record.ingredients,
          servingCount: record.servingCount,
          servingSizeGrams: record.servingSizeGrams,
          cookingMethod: record.cookingMethod
        }
      : {
          _id: record._id,
          restaurantId,
          $or: [{ ingredients: { $size: 0 } }, { ingredients: { $exists: false } }]
        };
    const result = await MenuItem.updateOne(
      updateFilter,
      { $set: buildKurumiRecipePatch(recipe, idsByName) },
      { runValidators: true }
    );
    if (result.matchedCount !== 1) fail("A target menu item changed during recipe seed; stopped safely");
  }
  return idsByName;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  activeStage = "argument validation";
  const options: KurumiRecipeSeedOptions = parseKurumiRecipeSeedOptions(args);
  if (options.help) {
    printHelp();
    return;
  }
  if (options.username !== TARGET_USERNAME) fail("This recipe seed is restricted to the approved Anvatcuti2 demo account");

  activeStage = "approved MongoDB target validation";
  const uri = process.env.MONGODB_URI || DEFAULT_URI;
  const target = assertKurumiSeedTarget(uri, options);
  try {
    activeStage = "MongoDB connection";
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    activeStage = "connected database verification";
    if (mongoose.connection.name !== "QDish") fail("Connected database does not match the approved QDish target");

    activeStage = "account and restaurant matching";
    const { user, restaurant } = await findTargetAccount(options.username);
    const restaurantId = restaurant._id as Types.ObjectId;
    const userId = user._id as Types.ObjectId;
    const subscriptionOwnerIds = uniqueOwnerIds([userId, restaurant.ownerId as Types.ObjectId | null]);
    const normalized = normalizeKurumiMenuSections(kurumiDaNangMenuSnapshot.sections);
    const fullRecipePlan = buildKurumiRecipePlan(normalized.items);

    activeStage = "read-only recipe preflight";
    const [beforeProtectedState, beforeMenu] = await Promise.all([
      readProtectedState(userId, restaurantId, subscriptionOwnerIds),
      readMenuRecords(restaurantId)
    ]);
    activeStage = "matching official recipe records and checking demo ingredient ownership";
    const pending = await findRecipesToSeed(
      normalized.items,
      beforeMenu,
      fullRecipePlan.recipes,
      restaurantId,
      options.refreshDemo
    );
    activeStage = "planning recipe ingredient mappings";
    const definitions = definitionsForPendingRecipes(pending, fullRecipePlan.ingredients);
    activeStage = "validating deterministic demo ingredient ownership";
    const ingredientResolution = await resolveDemoIngredients(restaurantId, definitions);
    if (!options.apply) {
      printDryRun(
        options.username,
        beforeMenu.length,
        beforeProtectedState.tables.length,
        pending,
        fullRecipePlan.recipes,
        ingredientResolution.toCreate,
        ingredientResolution.idsByName.size,
        ingredientResolution.toUpdateCategory,
        options.refreshDemo
      );
      return;
    }

    activeStage = "applying approved recipe estimates";
    if (target.hostname !== options.confirmHost) fail("MongoDB target changed before apply");
    console.log(`Applying estimated recipes to ${TARGET_RESTAURANT_NAME} (${options.username}).`);
    const idsByName = await applyRecipes(restaurantId, pending, ingredientResolution, definitions);
    activeStage = "post-apply verification";
    await verifyAfterApply(
      userId,
      restaurantId,
      subscriptionOwnerIds,
      beforeProtectedState,
      beforeMenu,
      normalized.items,
      pending,
      idsByName,
      definitions
    );
    console.log("KURUMI demo recipes applied and verified.");
    console.log(`Recipes written: ${pending.length}; existing recipes preserved: ${fullRecipePlan.recipes.length - pending.length}.`);
    console.log(`Unverified restaurant-local ingredients: ${ingredientResolution.toCreate.length} created, ${ingredientResolution.idsByName.size} reused, ${ingredientResolution.toUpdateCategory.length} category corrections.`);
    console.log("Nutrition/allergen fields, menu listing data, account, payments, subscriptions, tables, categories, and legacy menu items were preserved; no records deleted.");
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch(() => {
    console.error(`KURUMI recipe seed stopped during ${activeStage}. Database details were suppressed; created demo ingredients or recipe updates, if any, are safe to review and rerun.`);
    process.exitCode = 1;
  });
}
