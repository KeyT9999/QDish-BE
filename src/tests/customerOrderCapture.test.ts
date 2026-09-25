import assert from "node:assert/strict";
import mongoose from "mongoose";

import {
  buildCustomerOrderStatsPipeline,
  CustomerIdentityError,
  resolveCustomerForOrder
} from "../services/customerIdentityService.js";

const restaurantId = new mongoose.Types.ObjectId();
const customerId = new mongoose.Types.ObjectId();
const testKey = "unit-test-customer-pii-key-that-is-long-enough";

const makeSession = () => ({
  _id: new mongoose.Types.ObjectId(),
  restaurantId,
  customerId: undefined as mongoose.Types.ObjectId | undefined,
  customerName: undefined as string | undefined,
  customerPhone: undefined as string | undefined,
  saveCount: 0,
  async save() {
    this.saveCount += 1;
    return this;
  }
});

async function testBlankPhoneDoesNotCreateCustomer() {
  const session = makeSession();
  let upsertCount = 0;

  const result = await resolveCustomerForOrder({
    restaurantId,
    session,
    customerName: "  Minh Anh  ",
    customerPhone: "",
    marketingConsent: false,
    secret: testKey
  }, {
    findCustomerById: async () => null,
    upsertCustomer: async () => {
      upsertCount += 1;
      return null;
    }
  });

  assert.equal(result.customer, null);
  assert.equal(upsertCount, 0);
  assert.equal(session.customerName, "Minh Anh");
  assert.equal(session.customerId, undefined);
}

async function testBlankPhoneKeepsUsingCustomerAlreadyLinkedToSession() {
  const session = makeSession();
  session.customerId = customerId;
  const linkedCustomer = { _id: customerId, displayName: "Minh Anh" };
  let upsertCount = 0;

  const result = await resolveCustomerForOrder({
    restaurantId,
    session,
    customerPhone: "",
    secret: testKey
  }, {
    findCustomerById: async () => linkedCustomer,
    upsertCustomer: async () => {
      upsertCount += 1;
      return null;
    }
  });

  assert.equal(result.customer, linkedCustomer);
  assert.equal(result.sessionWasLinked, false);
  assert.equal(upsertCount, 0);
}

async function testEquivalentPhoneFormatsReuseOneRestaurantCustomer() {
  const customers = new Map<string, any>();
  const deps = {
    findCustomerById: async (id: unknown) => [...customers.values()].find((item) => item._id.equals(id)) || null,
    upsertCustomer: async (filter: any, update: any) => {
      let customer = customers.get(filter.phoneLookupHash);
      if (!customer) {
        customer = { _id: customerId, ...update.$setOnInsert };
        customers.set(filter.phoneLookupHash, customer);
      }
      Object.assign(customer, update.$set);
      return customer;
    }
  };

  const first = await resolveCustomerForOrder({
    restaurantId,
    session: makeSession(),
    customerName: "Minh Anh",
    customerPhone: "0912 345 678",
    marketingConsent: true,
    consentVersion: "crm-v1",
    secret: testKey
  }, deps);
  const second = await resolveCustomerForOrder({
    restaurantId,
    session: makeSession(),
    customerPhone: "+84912345678",
    marketingConsent: false,
    secret: testKey
  }, deps);

  assert.equal(customers.size, 1);
  assert.equal(first.customer?._id.toString(), second.customer?._id.toString());
  assert.equal(first.sessionWasLinked, true);
  assert.equal(second.sessionWasLinked, true);
  assert.equal(first.customer?.marketingConsent, true);
  assert.equal(second.customer?.displayName, "Minh Anh");
}

async function testRejectsChangingCustomerInsideOneSession() {
  const session = makeSession();
  session.customerId = customerId;

  await assert.rejects(
    resolveCustomerForOrder({
      restaurantId,
      session,
      customerName: "Khách khác",
      customerPhone: "0987654321",
      marketingConsent: false,
      secret: testKey
    }, {
      findCustomerById: async () => ({
        _id: customerId,
        phoneLookupHash: "different-hash"
      }),
      upsertCustomer: async () => null
    }),
    (error: unknown) => error instanceof CustomerIdentityError && error.statusCode === 409
  );
}

function testCustomerOrderStatsUpdateIsIdempotentAndBounded() {
  const orderId = "order-123";
  const pipeline = buildCustomerOrderStatsPipeline(orderId, 50_000, true, new Date("2026-09-25T00:00:00.000Z"));
  const update = pipeline[0].$set as Record<string, any>;

  assert.deepEqual(update.orderCount.$cond[0], {
    $in: [orderId, { $ifNull: ["$processedOrderStatsKeys", []] }]
  });
  assert.equal(update.orderCount.$cond[2].$add[1], 1);
  assert.equal(update.totalSpend.$cond[2].$add[1], 50_000);
  assert.equal(update.visitCount.$cond[2].$add[1], 1);
  assert.equal(update.processedOrderStatsKeys.$cond[2].$slice[1], -2048);
  assert.equal(update.processedOrderStatsKeys.$cond[1].$ifNull[0], "$processedOrderStatsKeys");
}

async function run() {
  await testBlankPhoneDoesNotCreateCustomer();
  await testBlankPhoneKeepsUsingCustomerAlreadyLinkedToSession();
  await testEquivalentPhoneFormatsReuseOneRestaurantCustomer();
  await testRejectsChangingCustomerInsideOneSession();
  testCustomerOrderStatsUpdateIsIdempotentAndBounded();
  console.log("customer order capture tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
