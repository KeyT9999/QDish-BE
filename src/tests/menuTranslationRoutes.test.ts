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
  const previousDeepSeekApiKey = process.env.DEEPSEEK_API_KEY;
  let mockedProviderStatus: number | null = null;
  let mockedDeepSeekStatus: number | null = null;
  let mockedDeepSeekCalls = 0;
  process.env.XKIRO_API_KEY = "test-only-key";
  process.env.DEEPSEEK_API_KEY = "";
  globalThis.fetch = (async (input, init) => {
    if (String(input) === "https://api.xkiro.com/v1/chat/completions") {
      if (mockedProviderStatus !== null) {
        return new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), {
          status: mockedProviderStatus,
          headers: { "retry-after": "0" }
        });
      }
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
    if (String(input) === "https://api.deepseek.com/chat/completions") {
      mockedDeepSeekCalls += 1;
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-only-key");
      if (mockedDeepSeekStatus !== null) {
        return new Response("mock upstream detail", { status: mockedDeepSeekStatus });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          en: { name: "DeepSeek English", description: "DeepSeek English description." },
          zhCN: { name: "DeepSeek 中文", description: "DeepSeek 中文描述。" }
        }) }, finish_reason: "stop" }]
      }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const { default: menuRouter, sendTranslationError } = await import("../routes/menuRoutes.js");
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
    let unexpectedErrorStatus = 0;
    let unexpectedErrorBody: any;
    sendTranslationError({
      locals: { requestId: "translation-error-test" },
      status(status: number) { unexpectedErrorStatus = status; return this; },
      json(body: unknown) { unexpectedErrorBody = body; return this; }
    } as any, new Error("internal database detail"));
    assert.equal(unexpectedErrorStatus, 500, "unexpected application errors must not be reported as bad gateway responses");
    assert.equal(unexpectedErrorBody.code, "TRANSLATION_DRAFT_FAILED");
    assert.equal(JSON.stringify(unexpectedErrorBody).includes("internal database detail"), false);

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

    const noDescriptionItem = await MenuItem.create({
      restaurantId: restaurant._id,
      name: "Trà nóng",
      description: "",
      price: 12000,
      category: "Đồ uống",
      available: false
    });
    const noDescriptionDraft = await fetch(`${baseUrl}/${noDescriptionItem._id}/translations/draft`, {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify({})
    });
    assert.equal(noDescriptionDraft.status, 200, "a dish without a Vietnamese description must still save both translations");
    const noDescriptionDraftJson = await noDescriptionDraft.json() as any;
    assert.equal(noDescriptionDraftJson.translations.en.draft.value.description, "");
    assert.equal(noDescriptionDraftJson.translations.zhCN.draft.value.description, "");

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

    mockedProviderStatus = 429;
    const rateLimited = await fetch(`${baseUrl}/${availableItem._id}/translations/draft`, {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify({})
    });
    assert.equal(rateLimited.status, 429);
    const rateLimitJson = await rateLimited.json() as any;
    assert.equal(rateLimitJson.code, "TRANSLATION_RATE_LIMITED");
    assert.equal(rateLimitJson.retryAfterSeconds, 0);
    mockedProviderStatus = null;

    process.env.DEEPSEEK_API_KEY = "test-only-key";
    mockedProviderStatus = 503;
    const fallbackDraft = await fetch(`${baseUrl}/${availableItem._id}/translations/draft`, {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify({})
    });
    assert.equal(fallbackDraft.status, 200, "a DeepSeek response is used after X-Kiro remains unavailable");
    const fallbackDraftJson = await fallbackDraft.json() as any;
    assert.equal(fallbackDraftJson.translations.en.draft.value.name, "DeepSeek English");
    assert.equal(fallbackDraftJson.translations.zhCN.draft.value.name, "DeepSeek 中文");
    assert.equal(mockedDeepSeekCalls, 1);
    mockedProviderStatus = null;

    mockedProviderStatus = 503;
    mockedDeepSeekStatus = 503;
    const providersFailed = await fetch(`${baseUrl}/${availableItem._id}/translations/draft`, {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify({})
    });
    assert.equal(providersFailed.status, 503);
    const providersFailedText = await providersFailed.text();
    assert.match(providersFailedText, /TRANSLATION_PROVIDER_FAILOVER_UNAVAILABLE/);
    assert.equal(providersFailedText.includes("test-only-key"), false, "provider credentials never appear in the response");
    assert.equal(providersFailedText.includes("mock upstream detail"), false, "provider response bodies stay private");
    mockedProviderStatus = null;
    mockedDeepSeekStatus = null;
    process.env.DEEPSEEK_API_KEY = "";

    const originalMenuItemSave = MenuItem.prototype.save;
    let persistenceFailureResponse: Response;
    try {
      (MenuItem.prototype as any).save = async function () {
        throw new Error("simulated translation draft persistence failure");
      };
      persistenceFailureResponse = await fetch(`${baseUrl}/${availableItem._id}/translations/draft`, {
        method: "POST",
        headers: headers(ownerToken),
        body: JSON.stringify({})
      });
    } finally {
      MenuItem.prototype.save = originalMenuItemSave;
    }
    assert.equal(persistenceFailureResponse!.status, 500, "database failures must not be reported as upstream translation failures");
    assert.equal((await persistenceFailureResponse!.json() as any).code, "TRANSLATION_DRAFT_FAILED");

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

    assert.equal((await fetch(`${baseUrl}/translations/bulk-publish`, {
      method: "POST", headers: headers(), body: JSON.stringify({ itemIds: [] })
    })).status, 401, "bulk publication requires authentication");

    // Bulk generation preserves review work and replaces only missing/stale locales.
    const editedAt = new Date("2026-01-02T03:04:05Z");
    const seedBulkItem = (translations: any, restaurantId = restaurant._id) => MenuItem.create({
      restaurantId, name: "Món thử", description: "Mô tả", price: 10000,
      category: "Món chính", available: true, translations
    });
    const preservedItem = await seedBulkItem({
      en: { approved: { value: { name: "Reviewed English", description: "Keep this." }, status: "APPROVED" } },
      zhCN: { draft: { value: { name: "手动修改", description: "保留。" }, generatedAt: editedAt } }
    });
    const missingItem = await seedBulkItem({
      en: { approved: { value: { name: "Old English", description: "Old." }, status: "STALE" } }
    });
    const preservedBefore = JSON.stringify(preservedItem.toObject().translations);
    const preserveResponse = await fetch(`${baseUrl}/${preservedItem._id}/translations/draft`, {
      method: "POST", headers: headers(ownerToken), body: JSON.stringify({ preserveExisting: true })
    });
    assert.equal(preserveResponse.status, 200);
    assert.equal(JSON.stringify((await MenuItem.findById(preservedItem._id).lean())!.translations), preservedBefore,
      "preservation keeps approved English and hand-edited Chinese byte-for-byte");
    const missingResponse = await fetch(`${baseUrl}/${missingItem._id}/translations/draft`, {
      method: "POST", headers: headers(ownerToken), body: JSON.stringify({ preserveExisting: true })
    });
    assert.equal(missingResponse.status, 200);
    const missingJson = await missingResponse.json() as any;
    assert.equal(missingJson.translations.en.draft.value.name, "Grilled pork rice", "stale approved text receives a replacement draft");
    assert.equal(missingJson.translations.zhCN.draft.value.name, "烤猪肉饭", "missing locale receives a draft");
    const invalidPreserve = await fetch(`${baseUrl}/${missingItem._id}/translations/draft`, {
      method: "POST", headers: headers(ownerToken), body: JSON.stringify({ preserveExisting: "true" })
    });
    assert.equal(invalidPreserve.status, 400, "preserveExisting must be a boolean");

    const bulkPublish = (body: any, token: string | undefined = ownerToken) => fetch(`${baseUrl}/translations/bulk-publish`, {
      method: "POST", headers: headers(token), body: JSON.stringify(body)
    });
    const ids = [preservedItem._id.toString(), missingItem._id.toString()];
    assert.equal((await fetch(`${baseUrl}/translations/bulk-publish`, {
      method: "POST", headers: headers(), body: JSON.stringify({ itemIds: ids })
    })).status, 401);
    assert.equal((await bulkPublish({ itemIds: ids }, staffToken)).status, 403);
    const foreignItem = await seedBulkItem({}, otherRestaurant._id);
    const incompleteItem = await seedBulkItem({
      en: { draft: { value: { name: "English only", description: "English description." }, generatedAt: editedAt } },
      zhCN: { approved: { value: { name: "旧", description: "旧描述。" }, status: "STALE" } }
    });
    const beforeRejected = JSON.stringify((await MenuItem.findById(missingItem._id).lean())!.translations);
    for (const body of [
      { itemIds: [] }, { itemIds: "bad" }, { itemIds: ["bad"] }, { itemIds: [12] },
      { itemIds: [ids[0], ids[0]] }, { itemIds: [ids[0], ids[0].toUpperCase()] },
      { itemIds: ids, restaurantId: otherRestaurant._id.toString() },
      { itemIds: ids, translations: { en: { name: "Injected" } } }
    ]) assert.equal((await bulkPublish(body)).status, 400, `reject malformed bulk body ${JSON.stringify(body)}`);
    assert.equal((await bulkPublish({ itemIds: [ids[1], foreignItem._id.toString()] })).status, 404);
    assert.equal((await bulkPublish({ itemIds: [ids[1], new mongoose.Types.ObjectId().toString()] })).status, 404);
    assert.equal((await bulkPublish({ itemIds: [ids[1], incompleteItem._id.toString()] })).status, 400);
    assert.equal(JSON.stringify((await MenuItem.findById(missingItem._id).lean())!.translations), beforeRejected,
      "all IDs and locales are validated before any writes");
    const bulkResponse = await bulkPublish({ itemIds: ids });
    assert.equal(bulkResponse.status, 200);
    const bulkJson = await bulkResponse.json() as any;
    assert.equal(bulkJson.publishedCount, 2);
    assert.equal(bulkJson.items.length, 2);
    const preservedPublished = bulkJson.items.find((item: any) => item.id === ids[0]);
    assert.deepEqual(preservedPublished.translations.en.approved, JSON.parse(preservedBefore).en.approved,
      "an approved locale without a draft is retained");
    assert.equal(preservedPublished.translations.zhCN.approved.value.name, "手动修改");
    for (const item of bulkJson.items) for (const locale of ["en", "zhCN"]) {
      assert.equal(item.translations[locale].displayStatus, "APPROVED");
      assert.equal(item.translations[locale].draft, undefined);
    }
    const publishedPublicItems = await (await fetch(`${baseUrl}?restaurantId=${restaurant._id}`)).json() as any[];
    assert.deepEqual(publishedPublicItems.find((item) => item.id === ids[0]).translations, {
      en: { name: "Reviewed English", description: "Keep this." }, zhCN: { name: "手动修改", description: "保留。" }
    }, "public output contains approved values without private draft metadata");
    const regeneratedLegacy = await fetch(`${baseUrl}/${preservedItem._id}/translations/draft`, {
      method: "POST", headers: headers(ownerToken), body: JSON.stringify({ preserveExisting: false })
    });
    assert.equal(regeneratedLegacy.status, 200);
    const regeneratedLegacyJson = await regeneratedLegacy.json() as any;
    assert.equal(regeneratedLegacyJson.translations.en.draft.value.name, "Grilled pork rice",
      "explicit false retains single-item regeneration behavior");
    assert.equal(regeneratedLegacyJson.translations.zhCN.approved.value.name, "手动修改",
      "single-item regeneration still preserves published values");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    globalThis.fetch = originalFetch;
    if (previousApiKey === undefined) delete process.env.XKIRO_API_KEY;
    else process.env.XKIRO_API_KEY = previousApiKey;
    if (previousDeepSeekApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousDeepSeekApiKey;
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
