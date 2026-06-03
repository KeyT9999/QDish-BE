/**
 * One-time migration script to repair the DishNutritionProfile collection.
 *
 * Fixes:
 * 1. Drops the stale `dish_id_1` (snake_case) unique index
 * 2. Migrates `dish_id` → `dishId` for any legacy documents
 * 3. Removes orphan documents with null dishId
 * 4. Ensures the correct `dishId_1` unique index exists
 *
 * Usage:
 *   npx tsx src/scripts/fixDishNutritionIndex.ts
 */
import "dotenv/config";
import mongoose from "mongoose";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("✅ Connected to MongoDB");

  const db = mongoose.connection.db;
  if (!db) {
    console.error("No database connection");
    process.exit(1);
  }

  const collectionName = "dishnutritionprofiles";

  // Check if collection exists
  const collections = await db.listCollections({ name: collectionName }).toArray();
  if (collections.length === 0) {
    console.log(`Collection "${collectionName}" does not exist. Nothing to repair.`);
    await mongoose.disconnect();
    return;
  }

  const collection = db.collection(collectionName);

  // 1. List current indexes
  const indexes = await collection.indexes();
  console.log("\n📋 Current indexes:");
  for (const idx of indexes) {
    console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}${idx.unique ? " (unique)" : ""}`);
  }

  // 2. Drop stale dish_id_1 index if it exists
  const hasLegacyIndex = indexes.some((idx) => idx.name === "dish_id_1");
  if (hasLegacyIndex) {
    await collection.dropIndex("dish_id_1");
    console.log("\n🗑️  Dropped stale index: dish_id_1");

    // 3. Migrate dish_id → dishId for documents that have the old field but not the new one
    const migrateResult = await collection.updateMany(
      { dishId: { $exists: false }, dish_id: { $exists: true, $ne: null } },
      [{ $set: { dishId: "$dish_id" } }] as any
    );
    console.log(`📦 Migrated ${migrateResult.modifiedCount} documents (dish_id → dishId)`);

    // 4. Unset the legacy dish_id field
    const unsetResult = await collection.updateMany(
      { dish_id: { $exists: true } },
      { $unset: { dish_id: "" } }
    );
    console.log(`🧹 Removed legacy dish_id field from ${unsetResult.modifiedCount} documents`);
  } else {
    console.log("\n✅ No stale dish_id_1 index found");
  }

  // 5. Delete orphan documents where dishId is null or missing
  const deleteResult = await collection.deleteMany({
    $or: [{ dishId: null }, { dishId: { $exists: false } }]
  });
  console.log(`🗑️  Deleted ${deleteResult.deletedCount} orphan documents (dishId is null/missing)`);

  // 6. Ensure correct dishId_1 unique index exists
  const hasDishIdIndex = indexes.some((idx) => idx.name === "dishId_1");
  if (!hasDishIdIndex) {
    await collection.createIndex({ dishId: 1 }, { name: "dishId_1", unique: true });
    console.log("🔧 Created correct unique index: dishId_1");
  } else {
    console.log("✅ Correct dishId_1 unique index already exists");
  }

  // 7. Show final state
  const finalIndexes = await collection.indexes();
  console.log("\n📋 Final indexes:");
  for (const idx of finalIndexes) {
    console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}${idx.unique ? " (unique)" : ""}`);
  }

  const docCount = await collection.countDocuments();
  console.log(`\n📊 Total documents in collection: ${docCount}`);

  await mongoose.disconnect();
  console.log("\n✅ Done. Disconnected from MongoDB.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
