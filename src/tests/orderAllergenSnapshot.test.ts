import assert from "node:assert/strict";
import {
  buildOrderAllergenSnapshots,
  parseReportedAllergies
} from "../services/orderAllergenSnapshotService.js";

const validAllergies = ["GLUTEN", "DAIRY", "NUTS", "SHELLFISH", "SOY", "EGGS", "FISH"];

for (const allergy of validAllergies) {
  assert.deepEqual(parseReportedAllergies([allergy]), { ok: true, allergies: [allergy] });
}

assert.deepEqual(parseReportedAllergies([" nuts ", "fish"]), { ok: true, allergies: ["NUTS", "FISH"] });
assert.deepEqual(parseReportedAllergies(undefined), { ok: true, allergies: [] });
assert.deepEqual(parseReportedAllergies([]), { ok: true, allergies: [] });
assert.deepEqual(parseReportedAllergies(["NUTS", " nuts "]), { ok: false });
assert.deepEqual(parseReportedAllergies(["PEANUTS"]), { ok: false });
assert.deepEqual(parseReportedAllergies([1]), { ok: false });
assert.deepEqual(parseReportedAllergies("NUTS"), { ok: false });
assert.deepEqual(parseReportedAllergies(validAllergies.concat("NUTS")), { ok: false });

const snapshots = buildOrderAllergenSnapshots({
  items: [
    { menuItemId: "nuts-dish" },
    { menuItemId: "safe-dish" },
    { menuItemId: "unknown-dish" },
    { menuItemId: "deleted-dish" },
    { menuItemId: "nuts-dish" }
  ],
  menuItems: [
    { id: "nuts-dish", allergens: [" nuts ", "DAIRY"], allergenInfoStatus: "REVIEWED" },
    { id: "safe-dish", allergens: [], allergenInfoStatus: "REVIEWED" },
    { id: "unknown-dish", allergens: ["NUTS"], allergenInfoStatus: "UNKNOWN" }
  ],
  reportedAllergies: ["NUTS"]
});

assert.deepEqual(snapshots.get("nuts-dish"), {
  allergenInfoStatus: "REVIEWED",
  allergenWarnings: ["NUTS"]
});
assert.deepEqual(snapshots.get("safe-dish"), {
  allergenInfoStatus: "REVIEWED",
  allergenWarnings: []
});
assert.deepEqual(snapshots.get("unknown-dish"), {
  allergenInfoStatus: "UNKNOWN",
  allergenWarnings: []
});
assert.deepEqual(snapshots.get("deleted-dish"), {
  allergenInfoStatus: "UNKNOWN",
  allergenWarnings: []
});
assert.equal(snapshots.size, 4, "duplicate order lines should share the item snapshot");

console.log("order allergen snapshot tests passed");
