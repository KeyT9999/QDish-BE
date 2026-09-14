import assert from "node:assert/strict";

import { createCustomerListHandler } from "../routes/customerRoutes.js";

const restaurantId = "507f1f77bcf86cd799439011";
const ownerId = "507f1f77bcf86cd799439012";

function makeResponse() {
  const state: { statusCode: number; body?: any } = { statusCode: 200 };
  return {
    state,
    response: {
      setHeader() {
        return this;
      },
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      json(body: unknown) {
        state.body = body;
        return this;
      }
    }
  };
}

function makeRequest(role = "RESTAURANT_OWNER") {
  return {
    auth: { role, sub: ownerId, restaurantId },
    query: { restaurantId, page: "1", limit: "20", search: "Minh" }
  };
}

async function testPlusOwnerCanListOwnCustomers() {
  let listCalls = 0;
  const result = makeResponse();
  const handler = createCustomerListHandler({
    resolveOwnerByRestaurant: async () => ({ toString: () => ownerId }),
    getPlanLimits: async () => ({ plan: { customerCrmEnabled: true } }),
    listCustomers: async () => {
      listCalls += 1;
      return { data: [{ id: "customer-1", displayName: "Minh" }], pagination: { page: 1 } };
    }
  } as any);

  await handler(makeRequest() as any, result.response as any);

  assert.equal(result.state.statusCode, 200);
  assert.equal(listCalls, 1);
  assert.equal(result.state.body.data[0].displayName, "Minh");
}

async function testFreeOwnerIsDeniedBeforeCustomerQuery() {
  let listCalls = 0;
  const result = makeResponse();
  const handler = createCustomerListHandler({
    resolveOwnerByRestaurant: async () => ({ toString: () => ownerId }),
    getPlanLimits: async () => ({ plan: { customerCrmEnabled: false } }),
    listCustomers: async () => {
      listCalls += 1;
      return { data: [], pagination: {} };
    }
  } as any);

  await handler(makeRequest() as any, result.response as any);

  assert.equal(result.state.statusCode, 403);
  assert.equal(listCalls, 0);
}

async function testUnrelatedOwnerAndStaffAreDenied() {
  const unrelated = makeResponse();
  const dependencies = {
    resolveOwnerByRestaurant: async () => ({ toString: () => "another-owner" }),
    getPlanLimits: async () => ({ plan: { customerCrmEnabled: true } }),
    listCustomers: async () => ({ data: [], pagination: {} })
  };
  const handler = createCustomerListHandler(dependencies as any);

  await handler(makeRequest() as any, unrelated.response as any);
  assert.equal(unrelated.state.statusCode, 403);

  const staff = makeResponse();
  await handler(makeRequest("STAFF") as any, staff.response as any);
  assert.equal(staff.state.statusCode, 403);
}

async function run() {
  await testPlusOwnerCanListOwnCustomers();
  await testFreeOwnerIsDeniedBeforeCustomerQuery();
  await testUnrelatedOwnerAndStaffAreDenied();
  console.log("customer CRM route tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
