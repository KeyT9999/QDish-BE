import "dotenv/config";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import type { AddressInfo } from "node:net";
import { connectDB } from "../config/db.js";
import { DishNutritionProfile } from "../models/DishNutritionProfile.js";
import { Ingredient } from "../models/Ingredient.js";
import { IngredientAlias } from "../models/IngredientAlias.js";
import { MenuItem } from "../models/MenuItem.js";
import { Restaurant } from "../models/Restaurant.js";
import ingredientRouter from "../routes/ingredientRoutes.js";

async function run() {
  await connectDB();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ownerId = new mongoose.Types.ObjectId();
  const restaurant = await Restaurant.create({
    name: "Ingredient allergen review route test",
    username: `ingredient_allergen_${suffix}`,
    ownerName: "Ingredient Review Owner",
    email: `ingredient_allergen_${suffix}@example.test`,
    address: "Test address",
    phone: "0900000011",
    ownerId
  });
  const ingredient = await Ingredient.create({
    name: `Review ingredient ${suffix}`,
    slug: `${restaurant._id}-review-ingredient-${suffix}`,
    category: "test",
    defaultUnit: "g",
    gramsPerUnit: 1,
    allergens: [],
    allergenInfoStatus: "UNKNOWN",
    isVerified: false,
    restaurantId: restaurant._id,
    source: "merchant"
  });
  const menuItem = await MenuItem.create({
    restaurantId: restaurant._id,
    name: "Dish depending on test ingredient",
    description: "",
    price: 100,
    category: "Test",
    imageUrl: "",
    ingredients: [{ ingredientId: ingredient._id, quantity: 10, unit: "g", gramsResolved: 10 }],
    servingCount: 1,
    allergens: ["PEANUT"],
    allergenInfoStatus: "REVIEWED",
    allergenCoverageStatus: "COMPLETE",
    allergenUnverifiedIngredientCount: 0,
    reviewedAllergens: ["PEANUT"],
    mayContainAllergens: [],
    allergenReviewMethod: "MANUAL",
    allergenReviewSourceType: "STAFF_ATTESTATION",
    allergenReviewSourceNote: "Previously reviewed declaration",
    allergenReviewedBy: ownerId,
    allergenReviewedAt: new Date()
  });

  const app = express();
  app.use(express.json());
  app.use("/api/ingredients", ingredientRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/api/ingredients/${ingredient._id}`;
  const token = jwt.sign({
    sub: ownerId.toString(),
    role: "RESTAURANT_OWNER",
    restaurantId: restaurant._id.toString()
  }, process.env.JWT_SECRET || "change-me");
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  };

  try {
    const rejected = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        allergens: ["PEANUT"],
        allergenInfoStatus: "REVIEWED",
        allergenInfoSourceType: "SUPPLIER_LABEL",
        allergenInfoSourceNote: " "
      })
    });
    assert.equal(rejected.status, 400, "review cannot be saved without evidence");
    assert.equal((await MenuItem.findById(menuItem._id).lean())?.allergenInfoStatus, "REVIEWED");

    const reviewed = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        allergens: ["PEANUT"],
        allergenInfoStatus: "REVIEWED",
        allergenInfoSourceType: "SUPPLIER_LABEL",
        allergenInfoSourceNote: "Đối chiếu nhãn của nhà cung cấp, phiên bản 2026-10.",
        allergenReviewedBy: new mongoose.Types.ObjectId().toString(),
        allergenReviewedAt: "2000-01-01T00:00:00.000Z"
      })
    });
    assert.equal(reviewed.status, 200);
    const reviewedJson = await reviewed.json() as any;
    assert.equal(reviewedJson.allergenInfoStatus, "REVIEWED");
    assert.equal(reviewedJson.allergenReviewedBy, ownerId.toString(), "reviewer identity comes from auth, not the client");
    assert.notEqual(new Date(reviewedJson.allergenReviewedAt).getTime(), new Date("2000-01-01T00:00:00.000Z").getTime());

    const invalidated = await MenuItem.findById(menuItem._id).lean();
    assert.equal(invalidated?.allergenInfoStatus, "UNKNOWN", "ingredient review changes invalidate dependent dish review");
    assert.deepEqual(invalidated?.allergens, ["PEANUT"], "recomputed candidate allergens remain visible");
    assert.deepEqual(invalidated?.reviewedAllergens, []);
    assert.equal(invalidated?.allergenCoverageStatus, "COMPLETE");

    await MenuItem.updateOne({ _id: menuItem._id }, {
      $set: {
        allergenInfoStatus: "REVIEWED",
        reviewedAllergens: [],
        allergenReviewMethod: "MANUAL",
        allergenReviewSourceType: "STAFF_ATTESTATION",
        allergenReviewSourceNote: "Explicitly reviewed empty declaration",
        allergenReviewedBy: ownerId,
        allergenReviewedAt: new Date()
      }
    });
    const deleted = await fetch(url, { method: "DELETE", headers });
    assert.equal(deleted.status, 200);
    const deletedJson = await deleted.json() as any;
    assert.equal(deletedJson.allergenImpact.recomputedCount, 1, "deletion recomputes dependent dishes");
    assert.deepEqual(deletedJson.allergenImpact.failedMenuItemIds, []);

    const afterDelete = await MenuItem.findById(menuItem._id).lean();
    assert.equal(afterDelete?.allergenInfoStatus, "UNKNOWN", "deleting a reviewed ingredient invalidates prior dish declaration");
    assert.equal(afterDelete?.allergenCoverageStatus, "INCOMPLETE", "dangling recipe reference remains incomplete");
    assert.deepEqual(afterDelete?.allergens, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await DishNutritionProfile.deleteMany({ restaurantId: restaurant._id });
    await MenuItem.deleteMany({ restaurantId: restaurant._id });
    await IngredientAlias.deleteMany({ ingredientId: ingredient._id });
    await Ingredient.deleteOne({ _id: ingredient._id });
    await Restaurant.deleteOne({ _id: restaurant._id });
    await mongoose.disconnect();
  }
  console.log("ingredient allergen review route tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
