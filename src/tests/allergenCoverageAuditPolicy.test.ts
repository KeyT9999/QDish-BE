import assert from "node:assert/strict";
import { assertAllergenAuditTarget, parseAllergenAuditOptions } from "../services/allergenCoverageAuditPolicy.js";

assert.deepEqual(parseAllergenAuditOptions([]), { apply: false, confirmedDatabase: undefined, confirmedHost: undefined });
assert.throws(() => parseAllergenAuditOptions(["--apply"]), /requires both/i);
assert.throws(() => parseAllergenAuditOptions(["--confirm-db", "local"]), /only together/i);
assert.throws(() => parseAllergenAuditOptions(["--unexpected"]), /unsupported/i);

const apply = parseAllergenAuditOptions(["--apply", "--confirm-db", "local", "--confirm-host", "127.0.0.1"]);
assert.doesNotThrow(() => assertAllergenAuditTarget(apply, "local", "127.0.0.1"));
assert.throws(() => assertAllergenAuditTarget(apply, "production", "127.0.0.1"), /database/i);
assert.throws(() => assertAllergenAuditTarget(apply, "local", "db.example.com"), /host/i);
assert.doesNotThrow(() => assertAllergenAuditTarget(parseAllergenAuditOptions([]), "production", "db.example.com"));

console.log("allergen coverage audit policy tests passed");
