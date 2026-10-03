import assert from "node:assert/strict";
import { MenuItem } from "../models/MenuItem.js";
import { serializeMenuItemForFeatures } from "../services/foodAttributeEntitlementService.js";
import {
  invalidateAllergenReview,
  resolveAllergenInfoStatusUpdate
} from "../services/allergenInfoStatusPolicy.js";

const newItem = new MenuItem({ name: "Món mới", allergens: [] });
assert.equal(newItem.allergenInfoStatus, "UNKNOWN");

const reviewedEmptyItem = new MenuItem({
  name: "Món không có dị ứng đã khai báo",
  allergens: [],
  allergenInfoStatus: "REVIEWED"
});
assert.equal(reviewedEmptyItem.allergenInfoStatus, "REVIEWED");
assert.deepEqual(reviewedEmptyItem.allergens, []);

const legacyResponse = serializeMenuItemForFeatures({ _id: "legacy-id", allergens: [] }, false);
assert.equal(legacyResponse.allergenInfoStatus, "UNKNOWN");

assert.deepEqual(resolveAllergenInfoStatusUpdate(false, "REVIEWED"), { ok: true, status: "REVIEWED" });
assert.deepEqual(resolveAllergenInfoStatusUpdate(false, "UNKNOWN"), { ok: true, status: "UNKNOWN" });
assert.deepEqual(resolveAllergenInfoStatusUpdate(false, undefined), { ok: true, status: undefined });
assert.deepEqual(resolveAllergenInfoStatusUpdate(true, "REVIEWED"), { ok: true, status: "UNKNOWN" });
assert.deepEqual(resolveAllergenInfoStatusUpdate(false, "SAFE"), { ok: false });

const recalculatedItem = { allergenInfoStatus: "REVIEWED" as const };
invalidateAllergenReview(recalculatedItem);
assert.equal(recalculatedItem.allergenInfoStatus, "UNKNOWN");

console.log("menu allergen metadata tests passed");
