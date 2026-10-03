import assert from "node:assert/strict";
import { hasVerifiedIngredientAllergenEvidence, resolveIngredientAllergenUpdate } from "../services/ingredientAllergenPolicy.js";

const reviewerId = "507f1f77bcf86cd799439011";
const now = new Date("2026-10-03T12:00:00.000Z");

assert.deepEqual(resolveIngredientAllergenUpdate({
  allergens: [],
  allergenInfoStatus: "UNKNOWN"
}, {
  allergens: ["nuts"],
  reviewerId,
  now
}), {
  ok: true,
  value: {
    allergens: ["PEANUT", "TREE_NUTS"],
    allergenInfoStatus: "UNKNOWN",
    allergenInfoSourceType: undefined,
    allergenInfoSourceNote: undefined,
    allergenReviewedBy: undefined,
    allergenReviewedAt: undefined,
    changed: true
  }
});

assert.equal(resolveIngredientAllergenUpdate({ allergens: [], allergenInfoStatus: "UNKNOWN" }, {
  allergens: ["NOT_AN_ALLERGEN"], reviewerId, now
}).ok, false);

assert.equal(resolveIngredientAllergenUpdate({ allergens: [], allergenInfoStatus: "UNKNOWN" }, {
  allergens: [], allergenInfoStatus: "REVIEWED", reviewerId, now
}).ok, false, "an empty reviewed declaration must include its evidence source and note");

const reviewedEmpty = resolveIngredientAllergenUpdate({ allergens: [], allergenInfoStatus: "UNKNOWN" }, {
  allergens: [],
  allergenInfoStatus: "REVIEWED",
  allergenInfoSourceType: "SUPPLIER_LABEL",
  allergenInfoSourceNote: "Đã kiểm tra nhãn nhà cung cấp lô 10/2026.",
  reviewerId,
  now
});
assert.equal(reviewedEmpty.ok, true);
if (reviewedEmpty.ok) {
  assert.equal(reviewedEmpty.value.allergenInfoStatus, "REVIEWED");
  assert.equal(reviewedEmpty.value.allergenReviewedBy, reviewerId);
  assert.equal(reviewedEmpty.value.allergenReviewedAt, now);
}

const changedWithoutEvidence = resolveIngredientAllergenUpdate({
  allergens: ["SOY"], allergenInfoStatus: "REVIEWED", allergenInfoSourceType: "SUPPLIER_LABEL",
  allergenInfoSourceNote: "Nhà cung cấp", allergenReviewedBy: reviewerId, allergenReviewedAt: now
}, { allergens: ["FISH"], reviewerId, now });
assert.equal(changedWithoutEvidence.ok, true);
if (changedWithoutEvidence.ok) {
  assert.equal(changedWithoutEvidence.value.allergenInfoStatus, "UNKNOWN");
  assert.equal(changedWithoutEvidence.value.allergenReviewedAt, undefined);
}

const legacyReviewedWithoutEvidence = resolveIngredientAllergenUpdate({
  allergens: ["PEANUT"],
  allergenInfoStatus: "REVIEWED"
}, { allergens: ["PEANUT"], reviewerId, now });
assert.equal(legacyReviewedWithoutEvidence.ok, true);
if (legacyReviewedWithoutEvidence.ok) {
  assert.equal(legacyReviewedWithoutEvidence.value.allergenInfoStatus, "UNKNOWN");
  assert.equal(legacyReviewedWithoutEvidence.value.changed, true, "incomplete legacy review evidence must trigger dependent menu invalidation");
}

assert.equal(hasVerifiedIngredientAllergenEvidence({
  allergens: ["PEANUT"],
  allergenInfoStatus: "REVIEWED",
  allergenInfoSourceType: "SUPPLIER_LABEL",
  allergenInfoSourceNote: "Đã kiểm tra nhãn lô 10/2026.",
  allergenReviewedBy: reviewerId,
  allergenReviewedAt: now
}), true);
assert.equal(hasVerifiedIngredientAllergenEvidence({
  allergens: ["PEANUT"],
  allergenInfoStatus: "REVIEWED",
  allergenInfoSourceType: "CURATED_REFERENCE_CATALOG",
  allergenInfoSourceNote: "Candidate value only.",
  allergenReviewedBy: reviewerId,
  allergenReviewedAt: now
}), false, "reference-catalog candidates cannot prove a restaurant reviewed declaration");
assert.equal(hasVerifiedIngredientAllergenEvidence({
  allergens: ["PEANUT", "LEGACY_UNKNOWN_CODE"],
  allergenInfoStatus: "REVIEWED",
  allergenInfoSourceType: "SUPPLIER_LABEL",
  allergenInfoSourceNote: "Supplier label.",
  allergenReviewedBy: reviewerId,
  allergenReviewedAt: now
}), false, "unsupported legacy codes cannot satisfy recipe coverage");

console.log("ingredient allergen policy tests passed");
