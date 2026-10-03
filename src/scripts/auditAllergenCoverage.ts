import "dotenv/config";
import mongoose from "mongoose";
import { DishNutritionProfile } from "../models/DishNutritionProfile.js";
import { Ingredient } from "../models/Ingredient.js";
import { MenuItem } from "../models/MenuItem.js";
import { normalizeAllergenCodes } from "../services/allergenSafetyService.js";
import { hasVerifiedIngredientAllergenEvidence } from "../services/ingredientAllergenPolicy.js";
import { hasValidMenuAllergenReviewDeclaration } from "../services/menuAllergenReviewService.js";
import { assertAllergenAuditTarget, parseAllergenAuditOptions } from "../services/allergenCoverageAuditPolicy.js";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/nhahang";

interface AuditRow {
  _id?: unknown;
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
  const reviewedIngredientIdsWithoutEvidence: string[] = [];
  const reviewedMenuItemIdsWithoutEvidence: string[] = [];

  for (const row of ingredients as unknown as AuditRow[]) {
    const metrics = tenantMetric(ingredientMetrics, row.restaurantId);
    increment(metrics, "total");
    if (row.allergenInfoStatus === "REVIEWED") increment(metrics, "reviewed");
    else increment(metrics, "unknown");
    const evidencePresent = hasVerifiedIngredientAllergenEvidence(row as unknown as Parameters<typeof hasVerifiedIngredientAllergenEvidence>[0]);
    if (row.allergenInfoStatus === "REVIEWED" && !evidencePresent) {
      increment(metrics, "reviewedWithoutEvidence");
      reviewedIngredientIdsWithoutEvidence.push(String(row._id));
    }
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
    const evidencePresent = hasValidMenuAllergenReviewDeclaration({
      method: row.allergenReviewMethod,
      sourceType: row.allergenReviewSourceType,
      sourceNote: row.allergenReviewSourceNote,
      reviewerId: row.allergenReviewedBy,
      reviewedAt: row.allergenReviewedAt,
      containsAllergens: row.reviewedAllergens,
      mayContainAllergens: row.mayContainAllergens
    });
    if (row.allergenInfoStatus === "REVIEWED" && !evidencePresent) {
      increment(metrics, "reviewedWithoutEvidence");
      reviewedMenuItemIdsWithoutEvidence.push(String(row._id));
    }
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
    invalidAllergenLists: invalidCodes,
    reviewedIngredientIdsWithoutEvidence,
    reviewedMenuItemIdsWithoutEvidence
  };
}

async function applySafeBackfill(
  reviewedIngredientIdsWithoutEvidence: readonly string[],
  reviewedMenuItemIdsWithoutEvidence: readonly string[]
) {
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
  let incompleteIngredientReviewCount = 0;
  let incompleteMenuReviewCount = 0;
  for (let offset = 0; offset < reviewedIngredientIdsWithoutEvidence.length; offset += 500) {
    const ids = reviewedIngredientIdsWithoutEvidence.slice(offset, offset + 500).map((id) => new mongoose.Types.ObjectId(id));
    const result = await Ingredient.updateMany(
      { _id: { $in: ids }, allergenInfoStatus: "REVIEWED" },
      {
        $set: { allergenInfoStatus: "UNKNOWN" },
        $unset: { allergenInfoSourceType: "", allergenInfoSourceNote: "", allergenReviewedBy: "", allergenReviewedAt: "" }
      }
    );
    incompleteIngredientReviewCount += result.modifiedCount;
  }
  for (let offset = 0; offset < reviewedMenuItemIdsWithoutEvidence.length; offset += 500) {
    const ids = reviewedMenuItemIdsWithoutEvidence.slice(offset, offset + 500).map((id) => new mongoose.Types.ObjectId(id));
    const result = await MenuItem.updateMany(
      { _id: { $in: ids }, allergenInfoStatus: "REVIEWED" },
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
    incompleteMenuReviewCount += result.modifiedCount;
  }
  const profileCoverage = await DishNutritionProfile.updateMany(
    { allergenCoverageStatus: { $exists: false } },
    { $set: { allergenCoverageStatus: "UNKNOWN", allergenUnverifiedIngredientCount: 0 } }
  );
  return {
    ingredientStatusesBackfilled: ingredientStatuses.modifiedCount,
    menuStatusesBackfilled: menuStatuses.modifiedCount,
    ingredientReviewsDemoted: incompleteIngredientReviewCount,
    menuReviewsDemoted: incompleteMenuReviewCount,
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
    const before = await collectAudit();
    console.log(JSON.stringify(before, null, 2));
    if (!options.apply) return;
    const changes = await applySafeBackfill(
      before.reviewedIngredientIdsWithoutEvidence,
      before.reviewedMenuItemIdsWithoutEvidence
    );
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
