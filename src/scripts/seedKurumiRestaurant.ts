import "dotenv/config";
import mongoose, { Types } from "mongoose";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { Table } from "../models/Table.js";
import { User, UserRole } from "../models/User.js";
import { kurumiDaNangMenuSnapshot } from "./kurumiDaNangMenuSnapshot.js";
import {
  assertKurumiSeedTarget,
  buildMenuItemListingPatch,
  indexExistingMenuMatches,
  menuCategoryKey,
  menuItemKey,
  normalizeKurumiMenuSections,
  parseKurumiSeedOptions,
  type KurumiMenuItem,
  type KurumiSeedOptions
} from "./kurumiMenuSeedData.js";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/nhahang";
const restaurantProfile = {
  name: "KURUMI - Healthy Vegan Food & Desserts",
  address: "17/22 My Da Dong 12, Bac My An, Ngu Hanh Son, Da Nang, Vietnam",
  phone: "+84 56 9844 088"
} as const;
let activeStage = "argument validation";

type SeedCategory = { _id: Types.ObjectId; name: string };
type SeedMenuRecord = {
  _id: Types.ObjectId;
  name: string;
  category: string;
  price: number;
  updatedAt?: Date;
};
type SeedPlan = {
  categoriesToCreate: string[];
  categoriesToUpdate: Array<{ id: Types.ObjectId; name: string }>;
  categoryIdsByKey: Map<string, Types.ObjectId>;
  itemsToCreate: KurumiMenuItem[];
  itemsToUpdate: Array<{ id: Types.ObjectId; item: KurumiMenuItem }>;
  allExistingItems: SeedMenuRecord[];
};

function printHelp(): void {
  console.log(
    [
      "Seed the official KURUMI Da Nang menu into one linked restaurant account.",
      "",
      "Usage:",
      "  npm run seed:kurumi -- --username <restaurant-account>",
      "  npm run seed:kurumi -- --username <restaurant-account> --apply --confirm-db QDish --confirm-host <configured-host>",
      "",
      "The first form is a read-only dry run. Apply mode only supports the confirmed QDish Atlas database."
    ].join("\n")
  );
}

function fail(message: string): never {
  throw new Error(message);
}

function assertUniqueByKey<T>(
  records: readonly T[],
  getKey: (record: T) => string,
  description: string
): Map<string, T> {
  const map = new Map<string, T>();
  for (const record of records) {
    const key = getKey(record);
    if (map.has(key)) fail(`Ambiguous existing ${description}; refusing to write`);
    map.set(key, record);
  }
  return map;
}

function createSeedPlan(
  categories: readonly SeedCategory[],
  existingItems: SeedMenuRecord[],
  incomingCategories: readonly string[],
  incomingItems: readonly KurumiMenuItem[]
): SeedPlan {
  const existingCategoriesByKey = assertUniqueByKey(
    categories,
    (category) => menuCategoryKey(category.name),
    "category names"
  );
  const existingItemsByKey = indexExistingMenuMatches(existingItems, incomingItems);
  const categoryIdsByKey = new Map<string, Types.ObjectId>();
  const categoriesToCreate: string[] = [];
  const categoriesToUpdate: Array<{ id: Types.ObjectId; name: string }> = [];

  for (const name of incomingCategories) {
    const key = menuCategoryKey(name);
    const existing = existingCategoriesByKey.get(key);
    if (!existing) {
      categoriesToCreate.push(name);
      continue;
    }
    categoryIdsByKey.set(key, existing._id);
    if (existing.name !== name) categoriesToUpdate.push({ id: existing._id, name });
  }

  const itemsToCreate: KurumiMenuItem[] = [];
  const itemsToUpdate: Array<{ id: Types.ObjectId; item: KurumiMenuItem }> = [];
  for (const item of incomingItems) {
    const existing = existingItemsByKey.get(menuItemKey(item));
    if (existing) itemsToUpdate.push({ id: existing._id, item });
    else itemsToCreate.push(item);
  }

  return {
    categoriesToCreate,
    categoriesToUpdate,
    categoryIdsByKey,
    itemsToCreate,
    itemsToUpdate,
    allExistingItems: existingItems
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function assertSnapshotUnchanged(label: string, before: unknown, after: unknown): void {
  if (stableJson(before) !== stableJson(after)) fail(`Post-seed verification failed for ${label}`);
}

async function findTargetAccount(username: string) {
  const users = await User.find({ username }).select(
    "_id username role restaurantId isActive email phone fullName name"
  ).lean();
  if (users.length !== 1) fail("Expected exactly one account matching --username");
  const user = users[0];
  if (!user.restaurantId) fail("The account is not linked to a restaurant");

  const restaurants = await Restaurant.find({
    _id: user.restaurantId,
    username
  }).select(
    "_id name username ownerName email address phone status active ownerId bankAccount bankName bankAccountNumber bankAccountHolder bankQrImageUrl bankQrPublicId paymentSettingsUpdatedByOwnerId paymentSettingsUpdatedAt"
  ).lean();
  if (restaurants.length !== 1) {
    fail("The account must link to exactly one restaurant with the same username");
  }
  return { user, restaurant: restaurants[0] };
}

async function readGuardSnapshots(
  userId: Types.ObjectId,
  restaurantId: Types.ObjectId,
  subscriptionOwnerIds: readonly Types.ObjectId[]
) {
  const user = await User.findById(userId).select(
    "_id username role restaurantId isActive email phone fullName name"
  ).lean();
  const restaurant = await Restaurant.findById(restaurantId).select(
    "ownerId ownerName email bankAccount bankName bankAccountNumber bankAccountHolder bankQrImageUrl bankQrPublicId paymentSettingsUpdatedByOwnerId paymentSettingsUpdatedAt status active"
  ).lean();
  const subscriptions = await Subscription.find({ ownerId: { $in: subscriptionOwnerIds } })
    .select("ownerId planId planCode status billingCycle amount startedAt expiresAt paymentOrderCode payosPaymentLinkId lastWarningLevel")
    .sort({ ownerId: 1, _id: 1 })
    .lean();
  const tables = await Table.find({ restaurantId })
    .select("_id code isActive status activeSessionId currentSessionCode updatedAt")
    .sort({ _id: 1 })
    .lean();

  return { user, restaurant, subscriptions, tables };
}

async function readSeedPlan(restaurantId: Types.ObjectId): Promise<SeedPlan> {
  const categories = await Category.find({ restaurantId }).select("_id name").lean();
  const existingItems = await MenuItem.find({ restaurantId })
    .select("_id name category price updatedAt")
    .lean() as unknown as SeedMenuRecord[];
  const normalized = normalizeKurumiMenuSections(kurumiDaNangMenuSnapshot.sections);
  return createSeedPlan(categories, existingItems, normalized.categories, normalized.items);
}

function printDryRun(
  username: string,
  currentCategoryCount: number,
  currentItemCount: number,
  currentTableCount: number,
  plan: SeedPlan,
  profileWillChange: boolean
): void {
  console.log("KURUMI Da Nang seed — DRY RUN (no database writes)");
  console.log(`Account verified: ${username} (one linked restaurant)`);
  console.log(`Restaurant: ${restaurantProfile.name}`);
  console.log(
    `Official categories (${plan.categoriesToCreate.length + plan.categoryIdsByKey.size}): ${plan.categoriesToCreate.length} create, ${plan.categoriesToUpdate.length} rename/update; ${currentCategoryCount} currently`
  );
  console.log(
    `Official menu items (${plan.itemsToCreate.length + plan.itemsToUpdate.length}): ${plan.itemsToCreate.length} create, ${plan.itemsToUpdate.length} update; ${currentItemCount} currently`
  );
  console.log(`Public restaurant profile fields to update: ${profileWillChange ? "yes" : "no"}`);
  console.log(`Tables: ${currentTableCount} preserved; deletions: 0`);
  console.log("To write, rerun with --apply --confirm-db QDish --confirm-host <configured-host>.");
}

async function assertPostApplyState(
  username: string,
  userId: Types.ObjectId,
  restaurantId: Types.ObjectId,
  subscriptionOwnerIds: readonly Types.ObjectId[],
  before: Awaited<ReturnType<typeof readGuardSnapshots>>,
  beforeCategoryCount: number,
  beforeItemCount: number,
  plan: SeedPlan,
  incomingItems: readonly KurumiMenuItem[]
): Promise<void> {
  const [userAfter, restaurantAfter, subscriptionsAfter, tablesAfter] = await Promise.all([
    User.findById(userId).select("_id username role restaurantId isActive email phone fullName name").lean(),
    Restaurant.findById(restaurantId).select("ownerId ownerName email bankAccount bankName bankAccountNumber bankAccountHolder bankQrImageUrl bankQrPublicId paymentSettingsUpdatedByOwnerId paymentSettingsUpdatedAt status active").lean(),
    Subscription.find({ ownerId: { $in: subscriptionOwnerIds } }).select("ownerId planId planCode status billingCycle amount startedAt expiresAt paymentOrderCode payosPaymentLinkId lastWarningLevel").sort({ ownerId: 1, _id: 1 }).lean(),
    Table.find({ restaurantId }).select("_id code isActive status activeSessionId currentSessionCode updatedAt").sort({ _id: 1 }).lean()
  ]);
  assertSnapshotUnchanged("account and owner/email fields", before.user, userAfter);
  assertSnapshotUnchanged("bank/payment settings", before.restaurant, restaurantAfter);
  assertSnapshotUnchanged("subscription", before.subscriptions, subscriptionsAfter);
  assertSnapshotUnchanged("tables", before.tables, tablesAfter);

  const restaurantAfterProfile = await Restaurant.findOne({ _id: restaurantId, username })
    .select("name address phone")
    .lean();
  if (
    !restaurantAfterProfile ||
    restaurantAfterProfile.name !== restaurantProfile.name ||
    restaurantAfterProfile.address !== restaurantProfile.address ||
    restaurantAfterProfile.phone !== restaurantProfile.phone
  ) {
    fail("Post-seed restaurant profile verification failed");
  }

  const [categoryCount, menuItems] = await Promise.all([
    Category.countDocuments({ restaurantId }),
    MenuItem.find({ restaurantId }).select("_id name description price category categoryId imageUrl available updatedAt").lean()
  ]);
  if (categoryCount !== beforeCategoryCount + plan.categoriesToCreate.length) {
    fail("Post-seed category count verification failed");
  }
  if (menuItems.length !== beforeItemCount + plan.itemsToCreate.length) {
    fail("Post-seed menu item count verification failed");
  }

  const persistedByKey = indexExistingMenuMatches(menuItems, incomingItems);
  for (const expected of incomingItems) {
    const persisted = persistedByKey.get(menuItemKey(expected));
    const expectedCategoryId = plan.categoryIdsByKey.get(menuCategoryKey(expected.category));
    if (
      !persisted ||
      persisted.name !== expected.name ||
      persisted.description !== expected.description ||
      persisted.price !== expected.price ||
      persisted.category !== expected.category ||
      persisted.imageUrl !== expected.imageUrl ||
      persisted.available !== expected.available ||
      !expectedCategoryId ||
      String(persisted.categoryId) !== String(expectedCategoryId)
    ) {
      fail("Post-seed published menu verification failed");
    }
  }

  const incomingKeys = new Set(incomingItems.map(menuItemKey));
  const legacyBefore = plan.allExistingItems.filter((item) => !incomingKeys.has(menuItemKey(item)));
  const legacyAfter = await MenuItem.find({ _id: { $in: legacyBefore.map((item) => item._id) }, restaurantId })
    .select("_id updatedAt")
    .lean() as unknown as Array<{ _id: Types.ObjectId; updatedAt?: Date }>;
  const legacyAfterById = new Map(legacyAfter.map((item) => [String(item._id), item.updatedAt?.toISOString()]));
  for (const item of legacyBefore) {
    if (legacyAfterById.get(String(item._id)) !== item.updatedAt?.toISOString()) {
      fail("Post-seed legacy menu preservation verification failed");
    }
  }
}

async function applySeed(
  username: string,
  userId: Types.ObjectId,
  restaurantId: Types.ObjectId,
  subscriptionOwnerIds: readonly Types.ObjectId[],
  plan: SeedPlan,
  incomingItems: readonly KurumiMenuItem[],
  before: Awaited<ReturnType<typeof readGuardSnapshots>>,
  currentCategoryCount: number,
  currentItemCount: number
): Promise<void> {
  const profileResult = await Restaurant.updateOne(
    { _id: restaurantId, username },
    { $set: restaurantProfile },
    { runValidators: true }
  );
  if (profileResult.matchedCount !== 1) fail("Restaurant target changed during seed; stopped");

  for (const { id, name } of plan.categoriesToUpdate) {
    const result = await Category.updateOne({ _id: id, restaurantId }, { $set: { name } }, { runValidators: true });
    if (result.matchedCount !== 1) fail("Category target changed during seed; stopped");
    plan.categoryIdsByKey.set(menuCategoryKey(name), id);
  }
  for (const name of plan.categoriesToCreate) {
    const category = await Category.create({ restaurantId, name });
    plan.categoryIdsByKey.set(menuCategoryKey(name), category._id);
  }

  for (const { id, item } of plan.itemsToUpdate) {
    const categoryId = plan.categoryIdsByKey.get(menuCategoryKey(item.category));
    if (!categoryId) fail("Menu category could not be resolved during seed");
    const result = await MenuItem.updateOne(
      { _id: id, restaurantId },
      { $set: buildMenuItemListingPatch(item, categoryId) },
      { runValidators: true }
    );
    if (result.matchedCount !== 1) fail("Menu item target changed during seed; stopped");
  }
  for (const item of plan.itemsToCreate) {
    const categoryId = plan.categoryIdsByKey.get(menuCategoryKey(item.category));
    if (!categoryId) fail("Menu category could not be resolved during seed");
    await MenuItem.create({
      restaurantId,
      ...buildMenuItemListingPatch(item, categoryId)
    });
  }

  activeStage = "post-apply verification";
  await assertPostApplyState(
    username,
    userId,
    restaurantId,
    subscriptionOwnerIds,
    before,
    currentCategoryCount,
    currentItemCount,
    plan,
    incomingItems
  );
  console.log("KURUMI Da Nang seed applied and verified.");
  console.log(`Categories: ${plan.categoriesToCreate.length} created, ${plan.categoriesToUpdate.length} updated.`);
  console.log(`Menu items: ${plan.itemsToCreate.length} created, ${plan.itemsToUpdate.length} updated.`);
  console.log("Restaurant profile updated; account, owner/email, payment settings, subscriptions, tables, and unrelated menu items preserved.");
  console.log("No records were deleted.");
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  activeStage = "argument validation";
  const options: KurumiSeedOptions = parseKurumiSeedOptions(args);
  if (options.help) {
    printHelp();
    return;
  }

  activeStage = "approved MongoDB target validation";
  const uri = process.env.MONGODB_URI || DEFAULT_URI;
  const target = assertKurumiSeedTarget(uri, options);
  try {
    activeStage = "MongoDB connection";
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    activeStage = "connected database verification";
    if (mongoose.connection.name !== "QDish") fail("Connected database does not match the approved QDish target");
    activeStage = "account and restaurant matching";
    const username = options.username!;
    const { user, restaurant } = await findTargetAccount(username);
    if (![UserRole.RESTAURANT_ADMIN, UserRole.RESTAURANT_OWNER].includes(user.role as UserRole)) {
      fail("The linked account is not a restaurant owner/admin account");
    }
    const subscriptionOwnerIds = [user._id, restaurant.ownerId]
      .filter((id): id is Types.ObjectId => Boolean(id))
      .filter((id, index, ids) => ids.findIndex((candidate) => String(candidate) === String(id)) === index);
    const normalized = normalizeKurumiMenuSections(kurumiDaNangMenuSnapshot.sections);
    activeStage = "read-only preflight";
    const [plan, before] = await Promise.all([
      readSeedPlan(restaurant._id),
      readGuardSnapshots(user._id, restaurant._id, subscriptionOwnerIds)
    ]);
    const currentCategoryCount = await Category.countDocuments({ restaurantId: restaurant._id });
    const currentItemCount = plan.allExistingItems.length;
    const profileWillChange =
      restaurant.name !== restaurantProfile.name ||
      restaurant.address !== restaurantProfile.address ||
      restaurant.phone !== restaurantProfile.phone;

    if (!options.apply) {
      printDryRun(
        username,
        currentCategoryCount,
        currentItemCount,
        before.tables.length,
        plan,
        profileWillChange
      );
      return;
    }

    activeStage = "applying approved menu data";
    if (target.hostname !== options.confirmHost) fail("MongoDB target changed before apply");
    console.log(`Applying official KURUMI menu to ${restaurantProfile.name} (${username}).`);
    await applySeed(
      username,
      user._id,
      restaurant._id,
      subscriptionOwnerIds,
      plan,
      normalized.items,
      before,
      currentCategoryCount,
      currentItemCount
    );
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch(() => {
    console.error(`KURUMI seed stopped during ${activeStage}. Database details were suppressed; partial writes, if any, are safe to review and rerun.`);
    process.exitCode = 1;
  });
}
