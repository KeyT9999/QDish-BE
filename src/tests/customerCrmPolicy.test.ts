import assert from "node:assert/strict";

import { canAccessCustomerCrm } from "../services/customerCrmPolicy.js";

assert.equal(canAccessCustomerCrm({ customerCrmEnabled: false }), false);
assert.equal(canAccessCustomerCrm({ customerCrmEnabled: true }), true);
assert.equal(canAccessCustomerCrm({ customerInsightsEnabled: true } as any), false);

console.log("customer CRM policy tests passed");
