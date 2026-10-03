import assert from "node:assert/strict";
import {
  buildOrderAllergenSnapshots,
  parseAllergyDisclosureStatus,
  parseReportedAllergies,
  resolveOrderReportedAllergies,
  snapshotOrderItems
} from "../services/orderAllergenSnapshotService.js";

const validAllergies = ["GLUTEN", "DAIRY", "PEANUT", "TREE_NUTS", "SESAME", "SHELLFISH", "SOY", "EGGS", "FISH"];

for (const allergy of validAllergies) {
  assert.deepEqual(parseReportedAllergies([allergy]), { ok: true, allergies: [allergy] });
}

assert.deepEqual(parseReportedAllergies([" nuts ", "fish"]), { ok: true, allergies: ["PEANUT", "TREE_NUTS", "FISH"] });
assert.deepEqual(parseReportedAllergies(["SESAME"]), { ok: true, allergies: ["SESAME"] });
assert.deepEqual(parseReportedAllergies(undefined), { ok: true, allergies: [] });
assert.deepEqual(parseReportedAllergies([]), { ok: true, allergies: [] });
assert.deepEqual(parseReportedAllergies(["NUTS", " nuts "]), { ok: false });
assert.deepEqual(parseReportedAllergies(["PEANUTS"]), { ok: false });
assert.deepEqual(parseReportedAllergies([1]), { ok: false });
assert.deepEqual(parseReportedAllergies("NUTS"), { ok: false });
assert.deepEqual(parseReportedAllergies(validAllergies.concat("GLUTEN")), { ok: false });
assert.deepEqual(parseAllergyDisclosureStatus(undefined, []), { ok: true, value: "NOT_ANSWERED" });
assert.deepEqual(parseAllergyDisclosureStatus(undefined, ["FISH"]), { ok: true, value: "DECLARED" });
assert.deepEqual(parseAllergyDisclosureStatus("NONE_DECLARED", []), { ok: true, value: "NONE_DECLARED" });
assert.deepEqual(parseAllergyDisclosureStatus("DECLARED", ["FISH"]), { ok: true, value: "DECLARED" });
assert.deepEqual(parseAllergyDisclosureStatus("DECLARED", []), { ok: false });
assert.deepEqual(parseAllergyDisclosureStatus("NONE_DECLARED", ["FISH"]), { ok: false });

const snapshots = buildOrderAllergenSnapshots({
  items: [
    { menuItemId: "nuts-dish" },
    { menuItemId: "safe-dish" },
    { menuItemId: "cross-contact-dish" },
    { menuItemId: "unknown-dish" },
    { menuItemId: "partially-invalid-unknown-dish" },
    { menuItemId: "overlapping-reviewed-dish" },
    { menuItemId: "missing-reviewed-declaration-dish" },
    { menuItemId: "deleted-dish" },
    { menuItemId: "nuts-dish" }
  ],
  menuItems: [
    { id: "nuts-dish", allergens: [" nuts ", "DAIRY"], reviewedAllergens: [" nuts ", "DAIRY"], mayContainAllergens: [], allergenInfoStatus: "REVIEWED", hasReviewEvidence: true },
    { id: "safe-dish", allergens: [], reviewedAllergens: [], mayContainAllergens: [], allergenInfoStatus: "REVIEWED", hasReviewEvidence: true },
    { id: "cross-contact-dish", allergens: [], reviewedAllergens: [], mayContainAllergens: ["SESAME"], allergenInfoStatus: "REVIEWED", hasReviewEvidence: true },
    { id: "unknown-dish", allergens: ["NUTS"], allergenInfoStatus: "UNKNOWN" },
    { id: "partially-invalid-unknown-dish", allergens: ["PEANUT", "LEGACY_UNKNOWN_CODE"], allergenInfoStatus: "UNKNOWN" },
    {
      id: "overlapping-reviewed-dish",
      allergens: ["PEANUT"],
      reviewedAllergens: ["PEANUT"],
      mayContainAllergens: ["PEANUT"],
      allergenInfoStatus: "REVIEWED",
      hasReviewEvidence: true
    },
    {
      id: "missing-reviewed-declaration-dish",
      allergens: ["PEANUT"],
      mayContainAllergens: [],
      allergenInfoStatus: "REVIEWED",
      hasReviewEvidence: true
    }
  ],
  reportedAllergies: ["NUTS", "SESAME"]
});

assert.deepEqual(snapshots.get("nuts-dish"), {
  allergenInfoStatus: "REVIEWED",
  allergenWarnings: ["PEANUT", "TREE_NUTS"],
  allergenContainsWarnings: ["PEANUT", "TREE_NUTS"],
  allergenMayContainWarnings: [],
  allergenWarningSource: "CONTAINS",
  allergenInformationIncomplete: false
});
assert.deepEqual(snapshots.get("safe-dish"), {
  allergenInfoStatus: "REVIEWED",
  allergenWarnings: [],
  allergenContainsWarnings: [],
  allergenMayContainWarnings: [],
  allergenInformationIncomplete: false
});
assert.deepEqual(snapshots.get("cross-contact-dish"), {
  allergenInfoStatus: "REVIEWED",
  allergenWarnings: ["SESAME"],
  allergenContainsWarnings: [],
  allergenMayContainWarnings: ["SESAME"],
  allergenWarningSource: "MAY_CONTAIN",
  allergenInformationIncomplete: false
});
assert.deepEqual(snapshots.get("unknown-dish"), {
  allergenInfoStatus: "UNKNOWN",
  allergenWarnings: ["PEANUT", "TREE_NUTS"],
  allergenContainsWarnings: [],
  allergenMayContainWarnings: [],
  allergenWarningSource: "CANDIDATE",
  allergenInformationIncomplete: true
});
assert.deepEqual(snapshots.get("partially-invalid-unknown-dish"), {
  allergenInfoStatus: "UNKNOWN",
  allergenWarnings: ["PEANUT"],
  allergenContainsWarnings: [],
  allergenMayContainWarnings: [],
  allergenWarningSource: "CANDIDATE",
  allergenInformationIncomplete: true
});
assert.deepEqual(snapshots.get("overlapping-reviewed-dish"), {
  allergenInfoStatus: "UNKNOWN",
  allergenWarnings: ["PEANUT"],
  allergenContainsWarnings: [],
  allergenMayContainWarnings: [],
  allergenWarningSource: "CANDIDATE",
  allergenInformationIncomplete: true
}, "ambiguous legacy declarations should fall back to known candidate conflicts and uncertainty");
assert.deepEqual(snapshots.get("missing-reviewed-declaration-dish"), {
  allergenInfoStatus: "UNKNOWN",
  allergenWarnings: ["PEANUT"],
  allergenContainsWarnings: [],
  allergenMayContainWarnings: [],
  allergenWarningSource: "CANDIDATE",
  allergenInformationIncomplete: true
}, "candidate allergens must remain a possible conflict when the reviewed declaration is missing");
assert.deepEqual(snapshots.get("deleted-dish"), {
  allergenInfoStatus: "UNKNOWN",
  allergenWarnings: [],
  allergenContainsWarnings: [],
  allergenMayContainWarnings: [],
  allergenInformationIncomplete: true
});
assert.equal(snapshots.size, 8, "duplicate order lines should share the item snapshot");

const submittedItems = [{
  menuItemId: "nuts-dish",
  name: "Món hạt",
  price: 100,
  quantity: 1,
  allergenInfoStatus: "UNKNOWN",
  allergenWarnings: ["FISH"],
  allergenInformationIncomplete: true,
  allergens: ["FISH"]
}];
const persistedItems = snapshotOrderItems(submittedItems, snapshots);
assert.deepEqual(persistedItems, [{
  menuItemId: "nuts-dish",
  name: "Món hạt",
  price: 100,
  quantity: 1,
  allergenInfoStatus: "REVIEWED",
  allergenWarnings: ["PEANUT", "TREE_NUTS"],
  allergenContainsWarnings: ["PEANUT", "TREE_NUTS"],
  allergenMayContainWarnings: [],
  allergenWarningSource: "CONTAINS",
  allergenInformationIncomplete: false
}]);
assert.deepEqual(resolveOrderReportedAllergies(persistedItems, ["NUTS"]), ["PEANUT", "TREE_NUTS"]);
assert.deepEqual(resolveOrderReportedAllergies([
  { allergenInfoStatus: "UNKNOWN" }
], ["NUTS"]), ["PEANUT", "TREE_NUTS"]);
assert.deepEqual(resolveOrderReportedAllergies(persistedItems, []), undefined);

console.log("order allergen snapshot tests passed");
