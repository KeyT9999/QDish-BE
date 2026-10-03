import "dotenv/config";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import type { AddressInfo } from "node:net";
import { connectDB } from "../config/db.js";
import { Ingredient } from "../models/Ingredient.js";
import { MenuItem } from "../models/MenuItem.js";
import { OwnerRestaurantQuotaLease } from "../models/OwnerRestaurantQuotaLease.js";
import { Restaurant } from "../models/Restaurant.js";
import menuRouter from "../routes/menuRoutes.js";

async function run() {
  await connectDB();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ownerId = new mongoose.Types.ObjectId();
  const restaurant = await Restaurant.create({
    name: "Allergen review route test",
    username: `allergen_review_${suffix}`,
    ownerName: "Allergen Review Owner",
    email: `allergen_review_${suffix}@example.test`,
    address: "Test address",
    phone: "0900000010",
    ownerId
  });
  const item = await MenuItem.create({
    restaurantId: restaurant._id,
    name: "Bánh hạt",
    description: "",
    price: 42000,
    category: "Test",
    imageUrl: "",
    ingredients: [],
    allergens: ["PEANUT"],
    allergenInfoStatus: "UNKNOWN"
  });
  const ingredient = await Ingredient.create({
    name: `Recipe ingredient ${suffix}`,
    slug: `${restaurant._id}-recipe-ingredient-${suffix}`,
    category: "test",
    defaultUnit: "g",
    gramsPerUnit: 1,
    allergens: ["PEANUT"],
    allergenInfoStatus: "UNKNOWN",
    isVerified: false,
    restaurantId: restaurant._id,
    source: "merchant"
  });
  const recipeItem = await MenuItem.create({
    restaurantId: restaurant._id,
    name: "Recipe review test dish",
    description: "",
    price: 30000,
    category: "Test",
    imageUrl: "",
    ingredients: [{ ingredientId: ingredient._id, quantity: 10, unit: "g", gramsResolved: 10 }],
    allergens: ["PEANUT"],
    allergenInfoStatus: "UNKNOWN",
    allergenCoverageStatus: "COMPLETE",
    allergenUnverifiedIngredientCount: 0
  });

  const app = express();
  app.use(express.json());
  app.use("/api/menu", menuRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/api/menu/${item._id}/allergen-review`;
  const secret = process.env.JWT_SECRET || "change-me";
  const ownerToken = jwt.sign({ sub: ownerId.toString(), role: "RESTAURANT_OWNER" }, secret);
  const staffToken = jwt.sign({
    sub: new mongoose.Types.ObjectId().toString(),
    role: "STAFF",
    restaurantId: restaurant._id.toString()
  }, secret);
  const headers = (token: string) => ({
    authorization: `Bearer ${token}`,
    "x-restaurant-id": restaurant._id.toString(),
    "content-type": "application/json"
  });

  try {
    const denied = await fetch(url, {
      method: "POST",
      headers: headers(staffToken),
      body: JSON.stringify({ method: "MANUAL", containsAllergens: [], mayContainAllergens: [], sourceType: "STAFF_ATTESTATION", sourceNote: "checked" })
    });
    assert.equal(denied.status, 403, "staff cannot certify allergen declarations");

    const incompleteEvidence = await fetch(url, {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify({ method: "MANUAL", containsAllergens: [], mayContainAllergens: [], sourceType: "STAFF_ATTESTATION", sourceNote: " " })
    });
    assert.equal(incompleteEvidence.status, 400);

    const reviewed = await fetch(url, {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify({
        method: "MANUAL",
        containsAllergens: ["TREE_NUTS"],
        mayContainAllergens: ["SESAME"],
        sourceType: "STAFF_ATTESTATION",
        sourceNote: "Đối chiếu danh sách nguyên liệu với nhãn nhà cung cấp."
      })
    });
    assert.equal(reviewed.status, 200);
    const reviewedJson = await reviewed.json() as any;
    assert.equal(reviewedJson.allergenInfoStatus, "REVIEWED");
    assert.deepEqual(reviewedJson.reviewedAllergens, ["TREE_NUTS"]);
    assert.deepEqual(reviewedJson.mayContainAllergens, ["SESAME"]);
    assert.equal(reviewedJson.allergenReviewSourceNote, undefined, "internal evidence notes are not exposed through public serialization");
    assert.equal(reviewedJson.allergenReviewedBy, undefined);

    const persisted = await MenuItem.findById(item._id).lean();
    assert.equal(persisted?.allergenInfoStatus, "REVIEWED");
    assert.equal(persisted?.allergenReviewMethod, "MANUAL");
    assert.equal(persisted?.allergenReviewSourceNote, "Đối chiếu danh sách nguyên liệu với nhãn nhà cung cấp.");

    const recipePayload = {
      method: "RECIPE",
      containsAllergens: ["PEANUT"],
      mayContainAllergens: [],
      sourceType: "RESTAURANT_RECIPE",
      sourceNote: "Đối chiếu công thức đang áp dụng."
    };
    const staleCoverage = await fetch(`http://127.0.0.1:${address.port}/api/menu/${recipeItem._id}/allergen-review`, {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify(recipePayload)
    });
    assert.equal(staleCoverage.status, 400, "cached complete coverage cannot override an unreviewed ingredient");
    assert.equal((await staleCoverage.json() as any).code, "RECIPE_NOT_COMPLETE");

    await Ingredient.updateOne({ _id: ingredient._id }, {
      $set: {
        allergenInfoStatus: "REVIEWED",
        allergenInfoSourceType: "SUPPLIER_LABEL",
        allergenInfoSourceNote: "Đối chiếu nhãn lô 10/2026.",
        allergenReviewedBy: ownerId,
        allergenReviewedAt: new Date()
      }
    });
    const missingIngredientAllergen = await fetch(`http://127.0.0.1:${address.port}/api/menu/${recipeItem._id}/allergen-review`, {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify({ ...recipePayload, containsAllergens: [] })
    });
    assert.equal(missingIngredientAllergen.status, 400, "recipe review cannot omit allergens confirmed on recipe ingredients");
    assert.equal((await missingIngredientAllergen.json() as any).code, "RECIPE_ALLERGENS_MISSING");

    const completeEvidence = await fetch(`http://127.0.0.1:${address.port}/api/menu/${recipeItem._id}/allergen-review`, {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify(recipePayload)
    });
    assert.equal(completeEvidence.status, 200, "recipe review is accepted after every referenced ingredient has source-backed review and all confirmed allergens are included");
    assert.equal((await completeEvidence.json() as any).allergenInfoStatus, "REVIEWED");

    const wrongRestaurantToken = jwt.sign({
      sub: new mongoose.Types.ObjectId().toString(),
      role: "RESTAURANT_OWNER"
    }, secret);
    const inaccessible = await fetch(url, {
      method: "POST",
      headers: headers(wrongRestaurantToken),
      body: JSON.stringify({ method: "MANUAL", containsAllergens: [], mayContainAllergens: [], sourceType: "STAFF_ATTESTATION", sourceNote: "check" })
    });
    assert.equal(inaccessible.status, 403, "owners cannot select a restaurant they do not own");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await MenuItem.deleteMany({ restaurantId: restaurant._id });
    await Ingredient.deleteOne({ _id: ingredient._id });
    await OwnerRestaurantQuotaLease.deleteOne({ _id: ownerId });
    await Restaurant.deleteOne({ _id: restaurant._id });
    await mongoose.disconnect();
  }
  console.log("menu allergen review route tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
