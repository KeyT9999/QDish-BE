/**
 * Clean up ALL remaining stale snake_case indexes from the
 * dishnutritionprofiles collection left over from a previous
 * Mongoose schema version.
 *
 * Usage:
 *   npx tsx src/scripts/cleanStaleIndexes.ts
 */
import "dotenv/config";
import mongoose from "mongoose";

const STALE_INDEX_NAMES = [
  "restaurant_id_1",
  "allergens_1",
  "food_attributes.attribute_1",
  "fit_scores.gym_fit_-1"
];

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

  const collection = db.collection("dishnutritionprofiles");
  const indexes = await collection.indexes();

  console.log("\n📋 Current indexes:");
  for (const idx of indexes) {
    console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}${idx.unique ? " (unique)" : ""}`);
  }

  for (const staleIndexName of STALE_INDEX_NAMES) {
    const exists = indexes.some((idx) => idx.name === staleIndexName);
    if (exists) {
      try {
        await collection.dropIndex(staleIndexName);
        console.log(`🗑️  Dropped stale index: ${staleIndexName}`);
      } catch (err: any) {
        console.warn(`⚠️  Could not drop ${staleIndexName}: ${err.message}`);
      }
    }
  }

  const finalIndexes = await collection.indexes();
  console.log("\n📋 Final indexes:");
  for (const idx of finalIndexes) {
    console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}${idx.unique ? " (unique)" : ""}`);
  }

  await mongoose.disconnect();
  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
