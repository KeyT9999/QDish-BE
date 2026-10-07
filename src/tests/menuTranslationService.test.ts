import assert from "node:assert/strict";
import { createMenuTranslationService } from "../services/menuTranslationService.js";
import { createTranslationProviderFailoverClient } from "../services/translationProviderFailover.js";

async function testGeneratesBothLocalesFromVietnameseSource() {
  let receivedMessages: Array<{ role: string; content: string }> = [];
  const service = createMenuTranslationService({
    complete: async (messages) => {
      receivedMessages = messages;
      return JSON.stringify({
        en: { name: "Grilled pork rice", description: "Served with rice." },
        zhCN: { name: "烤猪肉饭", description: "配米饭。" }
      });
    }
  });

  const result = await service.generateMenuItemTranslationDraft({
    name: "Cơm sườn nướng",
    description: "Ăn kèm cơm trắng.",
    category: "Món chính"
  });

  assert.deepEqual(result, {
    en: { name: "Grilled pork rice", description: "Served with rice." },
    zhCN: { name: "烤猪肉饭", description: "配米饭。" }
  });
  assert.equal(receivedMessages[0].role, "system");
  assert.match(receivedMessages[0].content, /do not invent|do not add/i);
  assert.match(receivedMessages[1].content, /Cơm sườn nướng/);
  assert.match(receivedMessages[1].content, /zhCN/);
}

async function testPreservesEmptySourceDescriptions() {
  const service = createMenuTranslationService({
    complete: async () => JSON.stringify({
      en: { name: "Phở", description: "Fresh herbs and beef broth." },
      zhCN: { name: "越南河粉", description: "牛肉汤配新鲜香草。" }
    })
  });

  const result = await service.generateMenuItemTranslationDraft({
    name: "Phở",
    description: "   ",
    category: "Món nước"
  });
  assert.deepEqual(result.en, { name: "Phở", description: "" });
  assert.deepEqual(result.zhCN, { name: "越南河粉", description: "" });
}

async function testAcceptsEmptyModelDescriptionsWhenSourceHasNoDescription() {
  const service = createMenuTranslationService({
    complete: async () => JSON.stringify({
      en: { name: "Vegan Milk Chocolate", description: "" },
      zhCN: { name: "纯素牛奶巧克力", description: "" }
    })
  });

  const result = await service.generateMenuItemTranslationDraft({
    name: "Sô Cô La Sữa Thuần Chay",
    description: "",
    category: "Đồ uống"
  });

  assert.deepEqual(result, {
    en: { name: "Vegan Milk Chocolate", description: "" },
    zhCN: { name: "纯素牛奶巧克力", description: "" }
  });
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
        return JSON.stringify({
          en: { name: "Vegan brownie", description: "Chocolate and walnuts." },
          zhCN: { name: "纯素布朗尼", description: "巧克力和核桃。" }
        });
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
  assert.deepEqual(result, {
    en: { name: "Vegan brownie", description: "Chocolate and walnuts." },
    zhCN: { name: "纯素布朗尼", description: "巧克力和核桃。" }
  });
}

async function testUsesFallbackWhenPrimaryReturnsInvalidTranslationOutput() {
  const providerCalls: string[] = [];
  const primary: { complete: (messages: Array<{ role: string; content: string }>) => Promise<string> } = {
    complete: async () => {
      providerCalls.push("primary");
      return JSON.stringify({ en: { name: "Vegan brownie", description: "" } });
    }
  };
  const fallback = {
    complete: async () => {
      providerCalls.push("fallback");
      return JSON.stringify({
        en: { name: "Vegan brownie", description: "Chocolate and walnuts." },
        zhCN: { name: "纯素布朗尼", description: "巧克力和核桃。" }
      });
    }
  };
  const service = createMenuTranslationService(primary, fallback, () => true);

  const result = await service.generateMenuItemTranslationDraft({
    name: "Bánh Brownie Thuần Chay",
    description: "Sô cô la và hạt óc chó.",
    category: "Bánh ngọt"
  });

  assert.deepEqual(providerCalls, ["primary", "fallback"]);
  assert.deepEqual(result, {
    en: { name: "Vegan brownie", description: "Chocolate and walnuts." },
    zhCN: { name: "纯素布朗尼", description: "巧克力和核桃。" }
  });
}

async function testTranslatesCategoryNamesWithoutDishFields() {
  let receivedMessages: Array<{ role: string; content: string }> = [];
  const service = createMenuTranslationService({
    complete: async (messages) => {
      receivedMessages = messages;
      return JSON.stringify({
        en: { name: "Main dishes" },
        zhCN: { name: "主菜" }
      });
    }
  });

  const result = await service.generateCategoryTranslationDraft({ name: "Món chính" });
  assert.deepEqual(result, { en: { name: "Main dishes" }, zhCN: { name: "主菜" } });
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

  const oversized = createMenuTranslationService({
    complete: async () => JSON.stringify({
      en: { name: "x".repeat(201), description: "" },
      zhCN: { name: "主菜", description: "" }
    })
  });
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

await testGeneratesBothLocalesFromVietnameseSource();
await testPreservesEmptySourceDescriptions();
await testAcceptsEmptyModelDescriptionsWhenSourceHasNoDescription();
await testUsesFallbackProviderWhenPrimaryTranslationProviderFails();
await testUsesFallbackWhenPrimaryReturnsInvalidTranslationOutput();
await testTranslatesCategoryNamesWithoutDishFields();
await testRejectsInvalidJsonAndUnexpectedShapes();
await testRejectsOversizedSourceBeforeCallingProvider();

console.log("menu translation service tests passed");
