import assert from "node:assert/strict";
import { createMenuTranslationService } from "../services/menuTranslationService.js";
import { createTranslationProviderFailoverClient } from "../services/translationProviderFailover.js";

const itemTranslations = {
  en: { name: "Grilled pork rice", description: "Served with rice." },
  zhCN: { name: "烤猪肉饭", description: "配米饭。" },
  ru: { name: "Рис со свининой на гриле", description: "Подается с рисом." },
  ko: { name: "구운 돼지고기 덮밥", description: "밥과 함께 제공됩니다." },
  hiIN: { name: "ग्रिल्ड पोर्क राइस", description: "चावल के साथ परोसा जाता है।" }
};

const categoryTranslations = {
  en: { name: "Main dishes" },
  zhCN: { name: "主菜" },
  ru: { name: "Основные блюда" },
  ko: { name: "메인 요리" },
  hiIN: { name: "मुख्य व्यंजन" }
};

async function testGeneratesAllLocalesFromVietnameseSource() {
  let receivedMessages: Array<{ role: string; content: string }> = [];
  const service = createMenuTranslationService({
    complete: async (messages) => {
      receivedMessages = messages;
      return JSON.stringify(itemTranslations);
    }
  });

  const result = await service.generateMenuItemTranslationDraft({
    name: "Cơm sườn nướng",
    description: "Ăn kèm cơm trắng.",
    category: "Món chính"
  });

  assert.deepEqual(result, itemTranslations);
  assert.equal(receivedMessages[0].role, "system");
  assert.match(receivedMessages[0].content, /do not invent|do not add/i);
  assert.match(receivedMessages[1].content, /Cơm sườn nướng/);
  for (const locale of ["en", "zhCN", "ru", "ko", "hiIN"]) {
    assert.match(receivedMessages[1].content, new RegExp(locale));
  }
}

async function testPreservesEmptySourceDescriptions() {
  const service = createMenuTranslationService({ complete: async () => JSON.stringify(itemTranslations) });
  const result = await service.generateMenuItemTranslationDraft({
    name: "Phở",
    description: "   ",
    category: "Món nước"
  });
  for (const value of Object.values(result)) assert.deepEqual(value, { ...value, description: "" });
}

async function testAcceptsEmptyModelDescriptionsWhenSourceHasNoDescription() {
  const emptyDescriptions = Object.fromEntries(
    Object.entries(itemTranslations).map(([locale, value]) => [locale, { ...value, description: "" }])
  );
  const service = createMenuTranslationService({ complete: async () => JSON.stringify(emptyDescriptions) });
  const result = await service.generateMenuItemTranslationDraft({
    name: "Sô Cô La Sữa Thuần Chay",
    description: "",
    category: "Đồ uống"
  });
  assert.deepEqual(result, emptyDescriptions);
}

async function testUsesFallbackProviderWhenPrimaryTranslationProviderFails() {
  const providerCalls: string[] = [];
  const client = createTranslationProviderFailoverClient(
    {
      complete: async () => {
        providerCalls.push("primary");
        throw new Error("primary unavailable");
      }
    },
    {
      complete: async () => {
        providerCalls.push("fallback");
        return JSON.stringify(itemTranslations);
      }
    },
    () => true
  );
  const service = createMenuTranslationService(client);
  const result = await service.generateMenuItemTranslationDraft({
    name: "Bánh Brownie Thuần Chay",
    description: "Sô cô la và hạt óc chó.",
    category: "Bánh ngọt"
  });
  assert.deepEqual(providerCalls, ["primary", "fallback"]);
  assert.deepEqual(result, itemTranslations);
}

async function testUsesFallbackWhenPrimaryReturnsInvalidTranslationOutput() {
  const providerCalls: string[] = [];
  const primary = {
    complete: async () => {
      providerCalls.push("primary");
      return JSON.stringify({ en: { name: "Vegan brownie", description: "" } });
    }
  };
  const fallback = {
    complete: async () => {
      providerCalls.push("fallback");
      return JSON.stringify(itemTranslations);
    }
  };
  const service = createMenuTranslationService(primary, fallback, () => true);
  const result = await service.generateMenuItemTranslationDraft({
    name: "Bánh Brownie Thuần Chay",
    description: "Sô cô la và hạt óc chó.",
    category: "Bánh ngọt"
  });
  assert.deepEqual(providerCalls, ["primary", "fallback"]);
  assert.deepEqual(result, itemTranslations);
}

async function testTranslatesCategoryNamesWithoutDishFields() {
  let receivedMessages: Array<{ role: string; content: string }> = [];
  const service = createMenuTranslationService({
    complete: async (messages) => {
      receivedMessages = messages;
      return JSON.stringify(categoryTranslations);
    }
  });
  const result = await service.generateCategoryTranslationDraft({ name: "Món chính" });
  assert.deepEqual(result, categoryTranslations);
  assert.match(receivedMessages[1].content, /Món chính/);
  assert.match(receivedMessages[1].content, /category/i);
}

async function testRejectsInvalidJsonAndUnexpectedShapes() {
  const malformed = createMenuTranslationService({ complete: async () => "not-json" });
  await assert.rejects(
    malformed.generateCategoryTranslationDraft({ name: "Món chính" }),
    (error: any) => error.code === "INVALID_TRANSLATION_OUTPUT"
  );

  const missingLocale = createMenuTranslationService({
    complete: async () => JSON.stringify({ en: { name: "Main dishes" } })
  });
  await assert.rejects(
    missingLocale.generateCategoryTranslationDraft({ name: "Món chính" }),
    (error: any) => error.code === "INVALID_TRANSLATION_OUTPUT"
  );

  const oversizedOutput = {
    ...itemTranslations,
    en: { name: "x".repeat(201), description: "" }
  };
  const oversized = createMenuTranslationService({ complete: async () => JSON.stringify(oversizedOutput) });
  await assert.rejects(
    oversized.generateMenuItemTranslationDraft({ name: "Phở", description: "", category: "Món nước" }),
    (error: any) => error.code === "INVALID_TRANSLATION_OUTPUT"
  );
}

async function testRejectsOversizedSourceBeforeCallingProvider() {
  let providerCalled = false;
  const service = createMenuTranslationService({
    complete: async () => {
      providerCalled = true;
      return "{}";
    }
  });
  await assert.rejects(
    service.generateMenuItemTranslationDraft({
      name: "Phở",
      description: "x".repeat(2001),
      category: "Món nước"
    }),
    (error: any) => error.code === "INVALID_TRANSLATION_INPUT"
  );
  assert.equal(providerCalled, false, "oversized source text must not reach the provider");
}

await testGeneratesAllLocalesFromVietnameseSource();
await testPreservesEmptySourceDescriptions();
await testAcceptsEmptyModelDescriptionsWhenSourceHasNoDescription();
await testUsesFallbackProviderWhenPrimaryTranslationProviderFails();
await testUsesFallbackWhenPrimaryReturnsInvalidTranslationOutput();
await testTranslatesCategoryNamesWithoutDishFields();
await testRejectsInvalidJsonAndUnexpectedShapes();
await testRejectsOversizedSourceBeforeCallingProvider();

console.log("menu translation service tests passed");
