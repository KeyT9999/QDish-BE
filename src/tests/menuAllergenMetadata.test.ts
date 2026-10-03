import assert from "node:assert/strict";
import { MenuItem } from "../models/MenuItem.js";
import { serializeMenuItemForFeatures } from "../services/foodAttributeEntitlementService.js";
import {
  invalidateAllergenReview,
  resolveAllergenInfoStatusUpdate
} from "../services/allergenInfoStatusPolicy.js";
import { resolveAllergenCoverage } from "../services/allergenCoveragePolicy.js";

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

const reviewedResponse = serializeMenuItemForFeatures({
  _id: "reviewed-id",
  allergens: ["NUTS"],
  allergenInfoStatus: "REVIEWED",
  allergenCoverageStatus: "COMPLETE" as const,
  allergenUnverifiedIngredientCount: 0,
  reviewedAllergens: ["NUTS"],
  mayContainAllergens: ["SESAME"],
  allergenReviewMethod: "MANUAL",
  allergenReviewSourceType: "STAFF_ATTESTATION",
  allergenReviewSourceNote: "Đã đối chiếu công thức.",
  allergenReviewedBy: "reviewer-id",
  allergenReviewedAt: new Date("2026-10-03T12:00:00.000Z")
}, false);
assert.equal(reviewedResponse.allergenInfoStatus, "REVIEWED");
assert.deepEqual(reviewedResponse.reviewedAllergens, ["PEANUT", "TREE_NUTS"]);
assert.deepEqual(reviewedResponse.mayContainAllergens, ["SESAME"]);

const invalidReviewedResponse = serializeMenuItemForFeatures({
  _id: "invalid-reviewed-id",
  allergens: ["PEANUT"],
  allergenInfoStatus: "REVIEWED",
  reviewedAllergens: ["PEANUT", "LEGACY_UNKNOWN_CODE"],
  mayContainAllergens: [],
  allergenReviewMethod: "MANUAL",
  allergenReviewSourceType: "CURATED_MENU_DESCRIPTION",
  allergenReviewSourceNote: "Candidate only.",
  allergenReviewedBy: "reviewer-id",
  allergenReviewedAt: new Date("2026-10-03T12:00:00.000Z")
}, false);
assert.equal(invalidReviewedResponse.allergenInfoStatus, "UNKNOWN", "invalid persisted evidence or allergen codes must not be presented as reviewed");

const overlappingReviewedResponse = serializeMenuItemForFeatures({
  _id: "overlapping-reviewed-id",
  allergenInfoStatus: "REVIEWED",
  reviewedAllergens: ["PEANUT"],
  mayContainAllergens: ["PEANUT"],
  allergenReviewMethod: "MANUAL",
  allergenReviewSourceType: "STAFF_ATTESTATION",
  allergenReviewSourceNote: "Đã đối chiếu công thức.",
  allergenReviewedBy: "reviewer-id",
  allergenReviewedAt: new Date("2026-10-03T12:00:00.000Z")
}, false);
assert.equal(overlappingReviewedResponse.allergenInfoStatus, "UNKNOWN", "overlapping declarations are ambiguous and must remain unverified");

const missingReviewedDeclarationResponse = serializeMenuItemForFeatures({
  _id: "missing-reviewed-declaration-id",
  allergens: ["PEANUT"],
  allergenInfoStatus: "REVIEWED",
  mayContainAllergens: [],
  allergenReviewMethod: "MANUAL",
  allergenReviewSourceType: "STAFF_ATTESTATION",
  allergenReviewSourceNote: "Đã đối chiếu công thức.",
  allergenReviewedBy: "reviewer-id",
  allergenReviewedAt: new Date("2026-10-03T12:00:00.000Z")
}, false);
assert.equal(missingReviewedDeclarationResponse.allergenInfoStatus, "UNKNOWN", "candidate allergens must not replace a missing reviewed declaration");

assert.deepEqual(resolveAllergenInfoStatusUpdate(false, "REVIEWED"), { ok: false });
assert.deepEqual(resolveAllergenInfoStatusUpdate(false, "UNKNOWN"), { ok: true, status: "UNKNOWN" });
assert.deepEqual(resolveAllergenInfoStatusUpdate(false, undefined), { ok: true, status: undefined });
assert.deepEqual(resolveAllergenInfoStatusUpdate(true, "REVIEWED"), { ok: true, status: "UNKNOWN" });
assert.deepEqual(resolveAllergenInfoStatusUpdate(false, "SAFE"), { ok: false });
assert.deepEqual(resolveAllergenCoverage({ requestedIngredientCount: 2, resolvedIngredientCount: 2, unverifiedIngredientCount: 0 }), {
  status: "COMPLETE",
  unverifiedIngredientCount: 0,
  missingIngredientCount: 0
});
assert.deepEqual(resolveAllergenCoverage({ requestedIngredientCount: 2, resolvedIngredientCount: 2, unverifiedIngredientCount: 1 }), {
  status: "INCOMPLETE",
  unverifiedIngredientCount: 1,
  missingIngredientCount: 0
});
assert.deepEqual(resolveAllergenCoverage({ requestedIngredientCount: 2, resolvedIngredientCount: 1, unverifiedIngredientCount: 0 }), {
  status: "INCOMPLETE",
  unverifiedIngredientCount: 0,
  missingIngredientCount: 1
});
assert.deepEqual(resolveAllergenCoverage({ requestedIngredientCount: 0, resolvedIngredientCount: 0, unverifiedIngredientCount: 0 }), {
  status: "UNKNOWN",
  unverifiedIngredientCount: 0,
  missingIngredientCount: 0
});

const recalculatedItem = {
  allergenInfoStatus: "REVIEWED" as const,
  reviewedAllergens: ["NUTS"],
  mayContainAllergens: ["DAIRY"],
  allergenReviewMethod: "MANUAL" as const,
  allergenReviewSourceType: "STAFF_ATTESTATION",
  allergenReviewSourceNote: "Đã kiểm tra",
  allergenReviewedBy: "reviewer",
  allergenReviewedAt: new Date()
};
invalidateAllergenReview(recalculatedItem);
assert.equal(recalculatedItem.allergenInfoStatus, "UNKNOWN");
assert.deepEqual(recalculatedItem.reviewedAllergens, []);
assert.deepEqual(recalculatedItem.mayContainAllergens, []);
assert.equal(recalculatedItem.allergenReviewedBy, undefined);

console.log("menu allergen metadata tests passed");
