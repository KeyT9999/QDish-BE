import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  assertKurumiSeedTarget,
  buildMenuItemListingPatch,
  indexExistingMenuMatches,
  menuItemKey,
  normalizeKurumiMenuSections,
  parseKurumiSeedOptions
} from "../scripts/kurumiMenuSeedData.js";
import { kurumiDaNangMenuSnapshot } from "../scripts/kurumiDaNangMenuSnapshot.js";

const item = {
  name: "Đậu hũ",
  description: "Đậu hũ, rau xanh",
  price: 25000,
  imageUrl: "https://kurumi.vn/menu-images/tofu.webp",
  available: true
};

const normalizedFixture = normalizeKurumiMenuSections([
  { name: "Gọi thêm - Rau củ", items: [item, { ...item }] },
  {
    name: "Gọi thêm - Đạm",
    items: [{ ...item, price: 30000 }]
  }
]);

assert.deepEqual(normalizedFixture.categories, ["Gọi thêm"]);
assert.equal(normalizedFixture.items.length, 2, "identical rows deduplicate but different prices remain separate");
assert.notEqual(
  menuItemKey(normalizedFixture.items[0]),
  menuItemKey(normalizedFixture.items[1]),
  "different-price variants have distinct repeatable upsert keys"
);
assert.equal(
  menuItemKey(normalizedFixture.items[0]),
  menuItemKey({ ...normalizedFixture.items[0], category: "  GỌI THÊM  " }),
  "upsert keys normalize whitespace, Unicode, and case"
);
const legacyDuplicate = { category: "Món cũ", name: "Mì chiên giòn", price: 50000 };
assert.equal(
  indexExistingMenuMatches([legacyDuplicate, { ...legacyDuplicate }], normalizedFixture.items).size,
  0,
  "unrelated duplicate legacy records are preserved and ignored by the import matcher"
);
assert.throws(
  () => indexExistingMenuMatches(
    [normalizedFixture.items[0], { ...normalizedFixture.items[0] }],
    normalizedFixture.items
  ),
  /ambiguous/i
);

assert.deepEqual(parseKurumiSeedOptions(["--username", "Anvatcuti2"]), {
  help: false,
  username: "anvatcuti2",
  apply: false,
  confirmDb: undefined,
  confirmHost: undefined
});
assert.equal(parseKurumiSeedOptions(["--help"]).help, true);
assert.throws(() => parseKurumiSeedOptions(["--username"]), /username/i);
assert.throws(() => parseKurumiSeedOptions(["--username", "test", "--apply"]), /confirm/i);
assert.throws(
  () => parseKurumiSeedOptions(["--username", "test", "--username", "other"]),
  /duplicate/i
);
assert.throws(
  () => parseKurumiSeedOptions(["--username", "test", "--unexpected"]),
  /unknown/i
);

const guardedApplyOptions = parseKurumiSeedOptions([
  "--username", "Anvatcuti2", "--apply", "--confirm-db", "QDish",
  "--confirm-host", "kimthang.mh3rrz2.mongodb.net"
]);
const atlasTarget = (host: string, database: string): string =>
  ["mongodb", "+srv:", "//", host, "/", database].join("");
assert.equal(
  assertKurumiSeedTarget(
    atlasTarget("kimthang.mh3rrz2.mongodb.net", "QDish"),
    guardedApplyOptions
  ).hostname,
  "kimthang.mh3rrz2.mongodb.net"
);
assert.throws(
  () => assertKurumiSeedTarget(
    atlasTarget("kimthang.mh3rrz2.mongodb.net", "other"),
    guardedApplyOptions
  ),
  /database/i
);
assert.throws(
  () => assertKurumiSeedTarget(
    atlasTarget("another.mongodb.net", "QDish"),
    guardedApplyOptions
  ),
  /host/i
);
assert.throws(
  () => assertKurumiSeedTarget("mongodb://127.0.0.1:27017/QDish", guardedApplyOptions),
  /atlas/i
);

assert.throws(
  () => normalizeKurumiMenuSections([{ name: "Món chính", items: [{ ...item, price: -1 }] }]),
  /price/i
);
assert.throws(
  () => normalizeKurumiMenuSections([{
    name: "Món chính",
    items: [{ ...item, imageUrl: "https://not-kurumi.example/tofu.webp" }]
  }]),
  /image/i
);
assert.throws(
  () => normalizeKurumiMenuSections([{
    name: "Món chính",
    items: [{ ...item, imageUrl: "http://kurumi.vn/tofu.webp" }]
  }]),
  /image/i
);

const officialMenu = normalizeKurumiMenuSections(kurumiDaNangMenuSnapshot.sections);
assert.equal(kurumiDaNangMenuSnapshot.sections.length, 30);
assert.equal(officialMenu.categories.length, 25);
assert.equal(officialMenu.items.length, 181);
assert.equal(
  officialMenu.items.filter((menuItem) => menuItem.name === "Latte Sữa Yến Mạch").length,
  1
);

const recipe = [{ ingredientId: "ingredient-1", quantity: 42, unit: "g", gramsResolved: 42 }];
const existingItem = {
  ingredients: recipe,
  calories: 123,
  allergens: ["nuts"],
  foodAttributes: ["vegan"]
};
const listingPatch = buildMenuItemListingPatch(
  normalizedFixture.items[0],
  new mongoose.Types.ObjectId()
);
const updatedItem = { ...existingItem, ...listingPatch };
assert.deepEqual(updatedItem.ingredients, recipe);
assert.equal(updatedItem.calories, 123);
assert.deepEqual(updatedItem.allergens, ["nuts"]);
assert.deepEqual(updatedItem.foodAttributes, ["vegan"]);

console.log("✅ KURUMI menu seed data tests passed");
