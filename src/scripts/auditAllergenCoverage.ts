import "dotenv/config";
import mongoose from "mongoose";
import { DishNutritionProfile } from "../models/DishNutritionProfile.js";
import { Ingredient } from "../models/Ingredient.js";
import { MenuItem } from "../models/MenuItem.js";
import { normalizeAllergenCodes } from "../services/allergenSafetyService.js";
import { assertAllergenAuditTarget, parseAllergenAuditOptions } from "../services/allergenCoverageAuditPolicy.js";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/nhahang";

interface AuditRow {
  restaurantId: unknown;
  allergens?: unknown;
  allergenInfoStatus?: unknown;
  allergenCoverageStatus?: unknown;
  allergenUnverifiedIngredientCount?: unknown;
  allergenInfoSourceType?: unknown;
  allergenInfoSourceNote?: unknown;
  allergenReviewMethod?: unknown;
  allergenReviewSourceType?: unknown;
  allergenReviewSourceNote?: unknown;
  allergenReviewedBy?: unknown;
  allergenReviewedAt?: unknown;
  ingredients?: Array<{ ingredientId?: unknown }>;
  reviewedAllergens?: unknown;
  mayContainAllergens?: unknown;
}

function tenantMetric(map: Map<string, Record<string, number>>, restaurantId: unknown) {
  const key = restaurantId ? String(restaurantId) : "<missing-tenant>";
  let value = map.get(key);
  if (!value) {
    value = {};
    map.set(key, value);
  }
  return value;
}

function increment(metrics: Record<string, number>, field: string) {
  metrics[field] = (metrics[field] ?? 0) + 1;
}

function candidateListStatus(value: unknown): "MISSING" | "VALID" | "INVALID" {
  if (value === undefined || value === null) return "MISSING";
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return "INVALID";
  return normalizeAllergenCodes(value as string[]) === undefined ? "INVALID" : "VALID";
}

async function collectAudit() {
  const [ingredients, menuItems] = await Promise.all([
    Ingredient.find({}).select("_id restaurantId allergens allergenInfoStatus allergenInfoSourceType allergenInfoSourceNote allergenReviewedBy allergenReviewedAt").lean(),
    MenuItem.find({}).select("_id restaurantId allergens allergenInfoStatus allergenCoverageStatus allergenUnverifiedIngredientCount reviewedAllergens mayContainAllergens allergenReviewMethod allergenReviewSourceType allergenReviewSourceNote allergenReviewedBy allergenReviewedAt ingredients").lean()
  ]);
  const ingredientMetrics = new Map<string, Record<string, number>>();
  const menuMetrics = new Map<string, Record<string, number>>();
  const referencedIngredientIds = new Set<string>();
  const knownIngredientIds = new Set(ingredients.map((ingredient) => String(ingredient._id)));
  const invalidCodes: Array<{ recordType: "ingredient" | "menu"; recordId: string; field: string }> = [];

  for (const row of ingredients as unknown as AuditRow[]) {
    const metrics = tenantMetric(ingredientMetrics, row.restaurantId);
    increment(metrics, "total");
    if (row.allergenInfoStatus === "REVIEWED") increment(metrics, "reviewed");
    else increment(metrics, "unknown");
    const evidencePresent = Boolean(row.allergenInfoSourceType && row.allergenInfoSourceNote && row.allergenReviewedBy && row.allergenReviewedAt);
    if (row.allergenInfoStatus === "REVIEWED" && !evidencePresent) increment(metrics, "reviewedWithoutEvidence");
    const status = candidateListStatus(row.allergens);
    if (status === "MISSING") increment(metrics, "missingAllergenList");
    if (status === "INVALID") {
      increment(metrics, "invalidAllergenLists");
      invalidCodes.push({ recordType: "ingredient", recordId: String((row as any)._id), field: "allergens" });
    }
  }

  for (const row of menuItems as unknown as AuditRow[]) {
    const metrics = tenantMetric(menuMetrics, row.restaurantId);
    increment(metrics, "total");
    if (row.allergenInfoStatus === "REVIEWED") increment(metrics, "reviewed");
    else increment(metrics, "unknown");
    if (!row.ingredients?.length) increment(metrics, "missingRecipe");
    if (row.allergenCoverageStatus !== "COMPLETE") increment(metrics, "coverageNotComplete");
    if (row.allergenInfoStatus === "UNKNOWN") increment(metrics, "needsReview");
    const evidencePresent = Boolean(row.allergenReviewMethod && row.allergenReviewSourceType && row.allergenReviewSourceNote && row.allergenReviewedBy && row.allergenReviewedAt);
    if (row.allergenInfoStatus === "REVIEWED" && !evidencePresent) increment(metrics, "reviewedWithoutEvidence");
    for (const field of ["allergens", "reviewedAllergens", "mayContainAllergens"] as const) {
      const value = row[field];
      if (value === undefined && field !== "allergens") continue;
      const status = candidateListStatus(value);
      if (status === "INVALID") {
        increment(metrics, "invalidAllergenLists");
        invalidCodes.push({ recordType: "menu", recordId: String((row as any)._id), field });
      }
    }
    for (const ingredient of row.ingredients ?? []) {
      if (ingredient.ingredientId) referencedIngredientIds.add(String(ingredient.ingredientId));
    }
  }

  const orphanedIngredients = Array.from(knownIngredientIds).filter((id) => !referencedIngredientIds.has(id)).length;
  const danglingReferences = Array.from(referencedIngredientIds).filter((id) => !knownIngredientIds.has(id)).length;
  return {
    ingredientCount: ingredients.length,
    menuItemCount: menuItems.length,
    orphanedIngredientCount: orphanedIngredients,
    danglingRecipeReferenceCount: danglingReferences,
    ingredientsByRestaurant: Object.fromEntries(ingredientMetrics),
    menuItemsByRestaurant: Object.fromEntries(menuMetrics),
    invalidAllergenLists: invalidCodes
  };
}

async function applySafeBackfill() {
  const ingredientStatuses = await Ingredient.updateMany(
    { allergenInfoStatus: { $exists: false } },
    { $set: { allergenInfoStatus: "UNKNOWN" } }
  );
  const menuStatuses = await MenuItem.updateMany(
    { allergenInfoStatus: { $exists: false } },
    {
      $set: {
        allergenInfoStatus: "UNKNOWN",
        reviewedAllergens: [],
        mayContainAllergens: []
      }
    }
  );
  const incompleteIngredientReviews = await Ingredient.updateMany(
    {
      allergenInfoStatus: "REVIEWED",
      $or: [
        { allergenInfoSourceType: { $exists: false } },
        { allergenInfoSourceNote: { $exists: false } },
        { allergenInfoSourceNote: "" },
        { allergenReviewedBy: { $exists: false } },
        { allergenReviewedAt: { $exists: false } }
      ]
    },
    {
      $set: { allergenInfoStatus: "UNKNOWN" },
      $unset: { allergenReviewedBy: "", allergenReviewedAt: "" }
    }
  );
  const incompleteMenuReviews = await MenuItem.updateMany(
    {
      allergenInfoStatus: "REVIEWED",
      $or: [
        { allergenReviewMethod: { $exists: false } },
        { allergenReviewSourceType: { $exists: false } },
        { allergenReviewSourceNote: { $exists: false } },
        { allergenReviewSourceNote: "" },
        { allergenReviewedBy: { $exists: false } },
        { allergenReviewedAt: { $exists: false } }
      ]
    },
    {
      $set: {
        allergenInfoStatus: "UNKNOWN",
        reviewedAllergens: [],
        mayContainAllergens: []
      },
      $unset: {
        allergenReviewMethod: "",
        allergenReviewSourceType: "",
        allergenReviewSourceNote: "",
        allergenReviewedBy: "",
        allergenReviewedAt: ""
      }
    }
  );
  const profileCoverage = await DishNutritionProfile.updateMany(
    { allergenCoverageStatus: { $exists: false } },
    { $set: { allergenCoverageStatus: "UNKNOWN", allergenUnverifiedIngredientCount: 0 } }
  );
  return {
    ingredientStatusesBackfilled: ingredientStatuses.modifiedCount,
    menuStatusesBackfilled: menuStatuses.modifiedCount,
    ingredientReviewsDemoted: incompleteIngredientReviews.modifiedCount,
    menuReviewsDemoted: incompleteMenuReviews.modifiedCount,
    nutritionCoverageBackfilled: profileCoverage.modifiedCount
  };
}

function hostFromMongoUri(uri: string): string {
  try {
    return new URL(uri).hostname;
  } catch {
    throw new Error("MONGODB_URI must be a valid MongoDB URI");
  }
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseAllergenAuditOptions(args);
  const uri = process.env.MONGODB_URI || DEFAULT_URI;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    if (options.apply) {
      assertAllergenAuditTarget(options, mongoose.connection.name, hostFromMongoUri(uri));
    }
    console.log(options.apply ? "Allergen coverage audit — GUARDED APPLY" : "Allergen coverage audit — DRY RUN (read-only)");
    console.log(JSON.stringify(await collectAudit(), null, 2));
    if (!options.apply) return;
    const changes = await applySafeBackfill();
    console.log("Safe backfill result:");
    console.log(JSON.stringify(changes, null, 2));
    console.log("Post-backfill audit:");
    console.log(JSON.stringify(await collectAudit(), null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/auditAllergenCoverage.ts")) {
  main().catch((error) => {
    console.error(`Allergen coverage audit stopped: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
