import "dotenv/config";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import type { AddressInfo } from "node:net";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { OwnerRestaurantQuotaLease } from "../models/OwnerRestaurantQuotaLease.js";
import { Restaurant } from "../models/Restaurant.js";

async function run() {
  await connectDB();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ownerId = new mongoose.Types.ObjectId();
  const restaurant = await Restaurant.create({
    name: "Category translation route test",
    username: `category_translation_${suffix}`,
    ownerName: "Category Translation Owner",
    email: `category_translation_${suffix}@example.test`,
    address: "Test address",
    phone: "0900000083",
    ownerId
  });
  const category = await Category.create({
    restaurantId: restaurant._id,
    name: "Món chính",
    translations: {
      en: {
        approved: { value: { name: "Main dishes" }, status: "APPROVED" },
        draft: { value: { name: "Main courses" }, generatedAt: new Date() }
      },
      zhCN: {
        approved: { value: { name: "主菜" }, status: "STALE" },
        draft: { value: { name: "主食" }, generatedAt: new Date() }
      }
    }
  });
  const menuItem = await MenuItem.create({
    restaurantId: restaurant._id,
    name: "Cơm gà",
    description: "",
    price: 38000,
    category: category.name,
    categoryId: category._id,
    available: true
  });

  const originalFetch = globalThis.fetch;
  const previousApiKey = process.env.XKIRO_API_KEY;
  process.env.XKIRO_API_KEY = "test-only-key";
  globalThis.fetch = (async (input, init) => {
    if (String(input) === "https://api.xkiro.com/v1/chat/completions") {
      return new Response(JSON.stringify({
        choices: [{
          message: { content: JSON.stringify({ en: { name: "Main course" }, zhCN: { name: "主菜" } }) },
          finish_reason: "stop"
        }]
      }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const { default: categoryRouter } = await import("../routes/categoryRoutes.js");
  const app = express();
  app.use(express.json());
  app.use("/api/categories", categoryRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/categories`;
  const secret = process.env.JWT_SECRET || "change-me";
  const ownerToken = jwt.sign({ sub: ownerId.toString(), role: "RESTAURANT_OWNER" }, secret);
  const staffToken = jwt.sign({ sub: new mongoose.Types.ObjectId().toString(), role: "STAFF", restaurantId: restaurant._id.toString() }, secret);
  const headers = (token: string) => ({
    authorization: `Bearer ${token}`,
    "x-restaurant-id": restaurant._id.toString(),
    "content-type": "application/json"
  });

  try {
    const unauthorized = await fetch(`${baseUrl}/manage`);
    assert.equal(unauthorized.status, 401);
    const staffDenied = await fetch(`${baseUrl}/manage`, { headers: headers(staffToken) });
    assert.equal(staffDenied.status, 403);

    const managed = await fetch(`${baseUrl}/manage`, { headers: headers(ownerToken) });
    assert.equal(managed.status, 200);
    const managedCategories = await managed.json() as any[];
    const managedCategory = managedCategories.find((row) => row._id === category._id.toString());
    assert.equal(managedCategory.translations.en.displayStatus, "DRAFT");
    assert.equal(managedCategory.translations.en.approved.value.name, "Main dishes");

    const publicCategories = await fetch(`${baseUrl}?restaurantId=${restaurant._id}`);
    assert.equal(publicCategories.status, 200);
    const publicJson = await publicCategories.json() as any[];
    const publicCategory = publicJson.find((row) => row._id === category._id.toString());
    assert.deepEqual(publicCategory.translations, { en: { name: "Main dishes" } });
    assert.equal(JSON.stringify(publicCategory).includes("Main courses"), false);
    assert.equal(JSON.stringify(publicCategory).includes("主食"), false);

    const generated = await fetch(`${baseUrl}/${category._id}/translations/draft`, {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify({})
    });
    assert.equal(generated.status, 200);
    const generatedJson = await generated.json() as any;
    assert.equal(generatedJson.translations.en.approved.value.name, "Main dishes");
    assert.equal(generatedJson.translations.en.draft.value.name, "Main course");

    const wrongRestaurant = await fetch(`${baseUrl}/${new mongoose.Types.ObjectId()}/translations/draft`, {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify({})
    });
    assert.equal(wrongRestaurant.status, 404);

    const renamed = await fetch(`${baseUrl}/${category._id}`, {
      method: "PATCH",
      headers: headers(ownerToken),
      body: JSON.stringify({ name: "Món đặc biệt" })
    });
    assert.equal(renamed.status, 200);
    const renamedJson = await renamed.json() as any;
    assert.equal(renamedJson.translations.en.approved.status, "STALE");
    assert.equal(renamedJson.translations.en.draft, undefined);

    const persistedItem = await MenuItem.findById(menuItem._id).lean();
    assert.equal(persistedItem?.category, "Món đặc biệt", "category rename still updates the item's canonical Vietnamese category text");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    globalThis.fetch = originalFetch;
    if (previousApiKey === undefined) delete process.env.XKIRO_API_KEY;
    else process.env.XKIRO_API_KEY = previousApiKey;
    await MenuItem.deleteMany({ restaurantId: restaurant._id });
    await Category.deleteMany({ restaurantId: restaurant._id });
    await OwnerRestaurantQuotaLease.deleteOne({ _id: ownerId });
    await Restaurant.deleteOne({ _id: restaurant._id });
    await mongoose.disconnect();
  }
  console.log("category translation route tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
