import "dotenv/config";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import type { AddressInfo } from "node:net";

import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { Ingredient } from "../models/Ingredient.js";
import { IngredientAlias } from "../models/IngredientAlias.js";
import ingredientRouter from "../routes/ingredientRoutes.js";

const JWT_SECRET = process.env.JWT_SECRET || "change-me";

function signToken(sub: string, role: string, restaurantId?: string) {
  const payload = {
    sub,
    role,
    ...(restaurantId ? { restaurantId } : {})
  };
  return jwt.sign(payload, JWT_SECRET);
}

async function run() {
  console.log("🏃 Connecting to MongoDB...");
  await connectDB();

  // Create temporary restaurants
  const ownerId1 = new mongoose.Types.ObjectId().toString();
  const ownerId2 = new mongoose.Types.ObjectId().toString();

  const restaurant1 = await Restaurant.create({
    name: "Test Restaurant 1",
    username: `test_rest_1_${Date.now()}`,
    ownerName: "Owner One",
    email: "owner1@test.com",
    address: "123 Street",
    phone: "0123456789",
    ownerId: new mongoose.Types.ObjectId(ownerId1)
  });

  const restaurant2 = await Restaurant.create({
    name: "Test Restaurant 2",
    username: `test_rest_2_${Date.now()}`,
    ownerName: "Owner Two",
    email: "owner2@test.com",
    address: "456 Street",
    phone: "0987654321",
    ownerId: new mongoose.Types.ObjectId(ownerId2)
  });

  console.log("Mock restaurants created:", restaurant1._id, restaurant2._id);

  // Generate tokens
  const superAdminToken = signToken(new mongoose.Types.ObjectId().toString(), "SUPER_ADMIN");
  const owner1Token = signToken(ownerId1, "RESTAURANT_OWNER", restaurant1._id.toString());
  const owner2Token = signToken(ownerId2, "RESTAURANT_OWNER", restaurant2._id.toString());

  // Setup express server
  const app = express();
  app.use(express.json());
  app.use("/api/ingredients", ingredientRouter);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/ingredients`;

  console.log(`Test server running at ${baseUrl}`);

  try {
    // ----------------------------------------------------
    // Test Case 1: Search without query
    // ----------------------------------------------------
    console.log("Test Case 1: Search with empty query");
    const res1 = await fetch(`${baseUrl}/search?q=`);
    const data1 = await res1.json();
    assert.deepEqual(data1, []);
    console.log("✅ Passed");

    // ----------------------------------------------------
    // Test Case 2: Create a global verified ingredient as SUPER_ADMIN
    // ----------------------------------------------------
    console.log("Test Case 2: Create global verified ingredient");
    const globalName = `Bông Cải Xanh ${Date.now()}`;
    const res2 = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${superAdminToken}`
      },
      body: JSON.stringify({
        name: globalName,
        category: "vegetables",
        defaultUnit: "g",
        gramsPerUnit: 1,
        caloriesPer100g: 34,
        proteinPer100g: 2.8,
        carbPer100g: 7,
        fatPer100g: 0.4,
        allergens: []
      })
    });

    assert.equal(res2.status, 201);
    const globalIng = await res2.json();
    assert.ok(globalIng._id);
    assert.equal(globalIng.isVerified, true);
    assert.equal(globalIng.restaurantId, null);
    assert.equal(globalIng.source, "global");
    assert.ok(globalIng.slug.startsWith("global-"));

    // Verify alias created
    const globalAlias = await IngredientAlias.findOne({ ingredientId: globalIng._id });
    assert.ok(globalAlias);
    assert.equal(globalAlias.alias, globalName.toLowerCase());
    console.log("✅ Passed");

    // ----------------------------------------------------
    // Test Case 3: Create a custom ingredient as RESTAURANT_OWNER 1
    // ----------------------------------------------------
    console.log("Test Case 3: Create custom ingredient as RESTAURANT_OWNER 1");
    const customName = `Nước Sốt Độc Quyền R1 ${Date.now()}`;
    const res3 = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner1Token}`,
        "x-restaurant-id": restaurant1._id.toString()
      },
      body: JSON.stringify({
        name: customName,
        category: "sauces",
        defaultUnit: "ml",
        gramsPerUnit: 1,
        caloriesPer100g: 120,
        proteinPer100g: 1,
        carbPer100g: 15,
        fatPer100g: 6,
        allergens: ["gluten"]
      })
    });

    assert.equal(res3.status, 201);
    const customIng = await res3.json();
    assert.ok(customIng._id);
    assert.equal(customIng.isVerified, false);
    assert.equal(customIng.restaurantId, restaurant1._id.toString());
    assert.equal(customIng.source, "merchant");
    assert.ok(customIng.slug.startsWith(`${restaurant1._id}-`));

    // Verify alias created
    const customAlias = await IngredientAlias.findOne({ ingredientId: customIng._id });
    assert.ok(customAlias);
    assert.equal(customAlias.alias, customName.toLowerCase());
    console.log("✅ Passed");

    // ----------------------------------------------------
    // Test Case 4: Search for global and custom ingredients
    // ----------------------------------------------------
    console.log("Test Case 4: Search validation");
    // Owner 1 searches: should see global ingredient and own custom ingredient
    const searchResR1 = await fetch(`${baseUrl}/search?q=bong cai&restaurantId=${restaurant1._id}`);
    const searchDataR1 = await searchResR1.json();
    assert.ok(searchDataR1.length > 0);
    assert.ok(searchDataR1.some((i: any) => i._id === globalIng._id));

    const searchCustomResR1 = await fetch(`${baseUrl}/search?q=doc quyen&restaurantId=${restaurant1._id}`);
    const searchCustomDataR1 = await searchCustomResR1.json();
    assert.ok(searchCustomDataR1.some((i: any) => i._id === customIng._id));

    // Owner 2 searches: should see global but NOT restaurant 1's custom ingredient
    const searchCustomResR2 = await fetch(`${baseUrl}/search?q=doc quyen&restaurantId=${restaurant2._id}`);
    const searchCustomDataR2 = await searchCustomResR2.json();
    assert.equal(searchCustomDataR2.length, 0);
    console.log("✅ Passed");

    // ----------------------------------------------------
    // Test Case 5: Edit the global ingredient as RESTAURANT_OWNER (should fail)
    // ----------------------------------------------------
    console.log("Test Case 5: Edit global ingredient as Restaurant Owner (expect 403)");
    const res5 = await fetch(`${baseUrl}/${globalIng._id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner1Token}`,
        "x-restaurant-id": restaurant1._id.toString()
      },
      body: JSON.stringify({
        caloriesPer100g: 50
      })
    });
    assert.equal(res5.status, 403);
    console.log("✅ Passed");

    // ----------------------------------------------------
    // Test Case 6: Edit the global ingredient as SUPER_ADMIN (should succeed)
    // ----------------------------------------------------
    console.log("Test Case 6: Edit global ingredient as SUPER_ADMIN");
    const res6 = await fetch(`${baseUrl}/${globalIng._id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${superAdminToken}`
      },
      body: JSON.stringify({
        caloriesPer100g: 40
      })
    });
    assert.equal(res6.status, 200);
    const updatedGlobal = await res6.json();
    assert.equal(updatedGlobal.caloriesPer100g, 40);
    console.log("✅ Passed");

    // ----------------------------------------------------
    // Test Case 7: Edit custom ingredient of Restaurant 1 as Restaurant Owner 2 (should fail)
    // ----------------------------------------------------
    console.log("Test Case 7: Edit Restaurant 1's custom ingredient as Restaurant Owner 2 (expect 403)");
    const res7 = await fetch(`${baseUrl}/${customIng._id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner2Token}`,
        "x-restaurant-id": restaurant2._id.toString()
      },
      body: JSON.stringify({
        caloriesPer100g: 150
      })
    });
    assert.equal(res7.status, 403);
    console.log("✅ Passed");

    // ----------------------------------------------------
    // Test Case 8: Edit custom ingredient of Restaurant 1 as Restaurant Owner 1 (should succeed, updating name & slug & alias)
    // ----------------------------------------------------
    console.log("Test Case 8: Edit custom ingredient of Restaurant 1 as Restaurant Owner 1");
    const newCustomName = `Sốt Siêu Cấp Độc Quyền R1 ${Date.now()}`;
    const res8 = await fetch(`${baseUrl}/${customIng._id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner1Token}`,
        "x-restaurant-id": restaurant1._id.toString()
      },
      body: JSON.stringify({
        name: newCustomName,
        caloriesPer100g: 130
      })
    });
    assert.equal(res8.status, 200);
    const updatedCustom = await res8.json();
    assert.equal(updatedCustom.name, newCustomName);
    assert.equal(updatedCustom.caloriesPer100g, 130);
    assert.ok(updatedCustom.slug.includes(restaurant1._id.toString()));

    // Verify alias updated
    const updatedAliases = await IngredientAlias.find({ ingredientId: customIng._id });
    assert.equal(updatedAliases.length, 1);
    assert.equal(updatedAliases[0].alias, newCustomName.toLowerCase());
    console.log("✅ Passed");

    // ----------------------------------------------------
    // Test Case 9: List ingredients and check visibility & filtering
    // ----------------------------------------------------
    console.log("Test Case 9: List ingredients filtering");
    // Owner 1 requests with type=all (should see global + their custom)
    const listResR1 = await fetch(`${baseUrl}?type=all`, {
      headers: {
        Authorization: `Bearer ${owner1Token}`,
        "x-restaurant-id": restaurant1._id.toString()
      }
    });
    const listDataR1 = await listResR1.json();
    assert.ok(listDataR1.ingredients.some((i: any) => i._id === globalIng._id));
    assert.ok(listDataR1.ingredients.some((i: any) => i._id === customIng._id));

    // Owner 2 requests with type=all (should see global but NOT R1's custom)
    const listResR2 = await fetch(`${baseUrl}?type=all`, {
      headers: {
        Authorization: `Bearer ${owner2Token}`,
        "x-restaurant-id": restaurant2._id.toString()
      }
    });
    const listDataR2 = await listResR2.json();
    assert.ok(listDataR2.ingredients.some((i: any) => i._id === globalIng._id));
    assert.ok(!listDataR2.ingredients.some((i: any) => i._id === customIng._id));

    // Owner 1 requests type=custom (should see only custom)
    const listCustomResR1 = await fetch(`${baseUrl}?type=custom`, {
      headers: {
        Authorization: `Bearer ${owner1Token}`,
        "x-restaurant-id": restaurant1._id.toString()
      }
    });
    const listCustomDataR1 = await listCustomResR1.json();
    assert.ok(listCustomDataR1.ingredients.every((i: any) => i.isVerified === false));
    console.log("✅ Passed");

    // ----------------------------------------------------
    // Test Case 10: Delete custom ingredient of Restaurant 1 as Restaurant Owner 2 (should fail)
    // ----------------------------------------------------
    console.log("Test Case 10: Delete custom ingredient as Owner 2 (expect 403)");
    const res10 = await fetch(`${baseUrl}/${customIng._id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${owner2Token}`,
        "x-restaurant-id": restaurant2._id.toString()
      }
    });
    assert.equal(res10.status, 403);
    console.log("✅ Passed");

    // ----------------------------------------------------
    // Test Case 11: Delete custom ingredient of Restaurant 1 as Restaurant Owner 1 (should succeed)
    // ----------------------------------------------------
    console.log("Test Case 11: Delete custom ingredient as Owner 1");
    const res11 = await fetch(`${baseUrl}/${customIng._id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${owner1Token}`,
        "x-restaurant-id": restaurant1._id.toString()
      }
    });
    assert.equal(res11.status, 200);

    // Verify deleted from DB
    const deletedCustom = await Ingredient.findById(customIng._id);
    assert.equal(deletedCustom, null);
    const deletedCustomAlias = await IngredientAlias.findOne({ ingredientId: customIng._id });
    assert.equal(deletedCustomAlias, null);
    console.log("✅ Passed");

    // ----------------------------------------------------
    // Test Case 12: Delete global ingredient as SUPER_ADMIN (should succeed)
    // ----------------------------------------------------
    console.log("Test Case 12: Delete global ingredient as SUPER_ADMIN");
    const res12 = await fetch(`${baseUrl}/${globalIng._id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${superAdminToken}`
      }
    });
    assert.equal(res12.status, 200);

    // Verify deleted from DB
    const deletedGlobal = await Ingredient.findById(globalIng._id);
    assert.equal(deletedGlobal, null);
    const deletedGlobalAlias = await IngredientAlias.findOne({ ingredientId: globalIng._id });
    assert.equal(deletedGlobalAlias, null);
    console.log("✅ Passed");

  } finally {
    // Cleanup temporary mock restaurants and close server
    console.log("Cleaning up mock restaurants...");
    await Restaurant.findByIdAndDelete(restaurant1._id);
    await Restaurant.findByIdAndDelete(restaurant2._id);

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await mongoose.disconnect();
    console.log("DB disconnected.");
  }

  console.log("\n🎉 Ingredients CRUD integration tests passed successfully!\n");
}

run().catch((error) => {
  console.error("🚨 Test failed:", error);
  process.exit(1);
});
