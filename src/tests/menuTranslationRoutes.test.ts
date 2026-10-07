import "dotenv/config";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import type { AddressInfo } from "node:net";
import { connectDB } from "../config/db.js";
import { MenuItem } from "../models/MenuItem.js";
import { OwnerRestaurantQuotaLease } from "../models/OwnerRestaurantQuotaLease.js";
import { Restaurant } from "../models/Restaurant.js";

async function run() {
  await connectDB();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ownerId = new mongoose.Types.ObjectId();
  const otherOwnerId = new mongoose.Types.ObjectId();
  const restaurant = await Restaurant.create({
    name: "Menu translation route test",
    username: `menu_translation_${suffix}`,
    ownerName: "Translation Owner",
    email: `menu_translation_${suffix}@example.test`,
    address: "Test address",
    phone: "0900000081",
    ownerId
  });
  const otherRestaurant = await Restaurant.create({
    name: "Other translation route test",
    username: `menu_translation_other_${suffix}`,
    ownerName: "Other Translation Owner",
    email: `menu_translation_other_${suffix}@example.test`,
    address: "Other test address",
    phone: "0900000082",
    ownerId: otherOwnerId
  });
  const unavailableItem = await MenuItem.create({
    restaurantId: restaurant._id,
    name: "Cơm sườn",
    description: "Cơm trắng.",
    price: 42000,
    category: "Món chính",
    available: false,
    translations: {
      en: {
        approved: { value: { name: "Pork rice", description: "Steamed rice." }, status: "APPROVED" },
        draft: { value: { name: "Grilled pork rice", description: "Rice with grilled pork." }, generatedAt: new Date() }
      },
      zhCN: {
        approved: { value: { name: "猪排饭", description: "米饭。" }, status: "STALE" },
        draft: { value: { name: "烤猪肉饭", description: "配米饭。" }, generatedAt: new Date() }
      }
    }
  });
  const availableItem = await MenuItem.create({
    restaurantId: restaurant._id,
    name: "Phở bò",
    description: "Nước dùng bò.",
    price: 50000,
    category: "Món nước",
    available: true,
    translations: {
      en: { approved: { value: { name: "Beef pho", description: "Beef broth." }, status: "APPROVED" } },
      zhCN: {
        approved: { value: { name: "牛肉粉", description: "牛肉汤。" }, status: "STALE" },
        draft: { value: { name: "越南牛肉粉", description: "牛肉汤。" }, generatedAt: new Date() }
      }
    }
  });

  const originalFetch = globalThis.fetch;
  const previousApiKey = process.env.XKIRO_API_KEY;
  process.env.XKIRO_API_KEY = "test-only-key";
  globalThis.fetch = (async (input, init) => {
    if (String(input) === "https://api.xkiro.com/v1/chat/completions") {
      const request = JSON.parse(String(init?.body));
      const userContent = JSON.parse(request.messages[1].content);
      const content = userContent.task.includes("category")
        ? JSON.stringify({ en: { name: "Main dishes" }, zhCN: { name: "主菜" } })
        : JSON.stringify({
          en: { name: "Grilled pork rice", description: "Served with steamed rice." },
          zhCN: { name: "烤猪肉饭", description: "配米饭。" }
        });
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const { default: menuRouter } = await import("../routes/menuRoutes.js");
  const app = express();
  app.use(express.json());
  app.use("/api/menu", menuRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/menu`;
  const secret = process.env.JWT_SECRET || "change-me";
  const ownerToken = jwt.sign({ sub: ownerId.toString(), role: "RESTAURANT_OWNER" }, secret);
  const otherOwnerToken = jwt.sign({ sub: otherOwnerId.toString(), role: "RESTAURANT_OWNER" }, secret);
  const staffToken = jwt.sign({
    sub: new mongoose.Types.ObjectId().toString(),
    role: "STAFF",
    restaurantId: restaurant._id.toString()
  }, secret);
  const headers = (token?: string, restaurantId = restaurant._id.toString()) => ({
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    "x-restaurant-id": restaurantId,
    "content-type": "application/json"
  });

  try {
    const unauthorized = await fetch(`${baseUrl}/manage`, { headers: headers() });
    assert.equal(unauthorized.status, 401, "management reads require authentication");

    const staffDenied = await fetch(`${baseUrl}/manage`, { headers: headers(staffToken) });
    assert.equal(staffDenied.status, 403, "staff cannot access translation management");

    const managed = await fetch(`${baseUrl}/manage?restaurantId=${otherRestaurant._id}`, {
      headers: headers(ownerToken)
    });
    assert.equal(managed.status, 200);
    const managedItems = await managed.json() as any[];
    assert.equal(managedItems.length, 2, "management reads include unavailable dishes and use the authenticated restaurant scope");
    const managedUnavailable = managedItems.find((item) => item.id === unavailableItem._id.toString());
    assert.equal(managedUnavailable.translations.en.displayStatus, "DRAFT");
    assert.equal(managedUnavailable.translations.en.approved.value.name, "Pork rice");
    assert.equal(managedUnavailable.translations.en.draft.value.name, "Grilled pork rice");

    const publicMenu = await fetch(`${baseUrl}?restaurantId=${restaurant._id}&includeUnavailable=true`);
    assert.equal(publicMenu.status, 200);
    const publicItems = await publicMenu.json() as any[];
    assert.equal(publicItems.length, 1, "public reads must not expose unavailable dishes even with the legacy query flag");
    assert.equal(publicItems[0].id, availableItem._id.toString());
    assert.deepEqual(publicItems[0].translations, { en: { name: "Beef pho", description: "Beef broth." } });
    assert.equal(JSON.stringify(publicItems[0]).includes("越南牛肉粉"), false, "public reads omit stale and draft translations");

    const generated = await fetch(`${baseUrl}/${unavailableItem._id}/translations/draft`, {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify({})
    });
    assert.equal(generated.status, 200);
    const generatedJson = await generated.json() as any;
    assert.equal(generatedJson.translations.en.displayStatus, "DRAFT");
    assert.equal(generatedJson.translations.en.approved.value.name, "Pork rice", "regeneration preserves the currently published value");
    assert.equal(generatedJson.translations.en.draft.value.name, "Grilled pork rice");

    const updatedDraft = await fetch(`${baseUrl}/${unavailableItem._id}/translations/en`, {
      method: "PATCH",
      headers: headers(ownerToken),
      body: JSON.stringify({ name: "Charcoal pork rice", description: "Served with rice.", publish: false })
    });
    assert.equal(updatedDraft.status, 200);
    const draftJson = await updatedDraft.json() as any;
    assert.equal(draftJson.translations.en.approved.value.name, "Pork rice");
    assert.equal(draftJson.translations.en.draft.value.name, "Charcoal pork rice");

    const published = await fetch(`${baseUrl}/${unavailableItem._id}/translations/en`, {
      method: "PATCH",
      headers: headers(ownerToken),
      body: JSON.stringify({ name: "Charcoal pork rice", description: "Served with rice.", publish: true })
    });
    assert.equal(published.status, 200);
    const publishedJson = await published.json() as any;
    assert.equal(publishedJson.translations.en.displayStatus, "APPROVED");
    assert.equal(publishedJson.translations.en.approved.value.name, "Charcoal pork rice");
    assert.equal(publishedJson.translations.en.draft, undefined);

    const wrongRestaurant = await fetch(`${baseUrl}/${unavailableItem._id}/translations/draft`, {
      method: "POST",
      headers: headers(otherOwnerToken, otherRestaurant._id.toString()),
      body: JSON.stringify({})
    });
    assert.equal(wrongRestaurant.status, 404, "translation writes are scoped to the selected restaurant");

    const renamed = await fetch(`${baseUrl}/${unavailableItem._id}`, {
      method: "PATCH",
      headers: headers(ownerToken),
      body: JSON.stringify({ name: "Cơm sườn nướng" })
    });
    assert.equal(renamed.status, 200);
    const renamedJson = await renamed.json() as any;
    assert.equal(renamedJson.translations.en.approved.status, "STALE", "changing Vietnamese source text marks approved translations stale");
    assert.equal(renamedJson.translations.en.draft, undefined, "source changes discard drafts tied to the previous text");

    const invalidLocale = await fetch(`${baseUrl}/${unavailableItem._id}/translations/fr`, {
      method: "PATCH",
      headers: headers(ownerToken),
      body: JSON.stringify({ name: "Pork rice", description: "", publish: true })
    });
    assert.equal(invalidLocale.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    globalThis.fetch = originalFetch;
    if (previousApiKey === undefined) delete process.env.XKIRO_API_KEY;
    else process.env.XKIRO_API_KEY = previousApiKey;
    await MenuItem.deleteMany({ restaurantId: { $in: [restaurant._id, otherRestaurant._id] } });
    await OwnerRestaurantQuotaLease.deleteMany({ _id: { $in: [ownerId, otherOwnerId] } });
    await Restaurant.deleteMany({ _id: { $in: [restaurant._id, otherRestaurant._id] } });
    await mongoose.disconnect();
  }
  console.log("menu translation route tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
