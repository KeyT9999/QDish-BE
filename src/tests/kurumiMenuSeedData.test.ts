import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  buildMenuItemListingPatch,
  menuItemKey,
  normalizeKurumiMenuSections
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
