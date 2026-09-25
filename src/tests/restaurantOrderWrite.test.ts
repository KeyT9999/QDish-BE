import assert from "node:assert/strict";
import mongoose from "mongoose";
import { RestaurantStatus } from "../models/Restaurant.js";
import { createRestaurantOrderWriteService } from "../services/restaurantOrderWriteService.js";

async function run() {
  const restaurantId = new mongoose.Types.ObjectId();
  const ownerId = new mongoose.Types.ObjectId();
  const restaurant: { status: RestaurantStatus; active: boolean; archivedAt?: Date } = {
    status: RestaurantStatus.ACTIVE,
    active: true
  };
  let queue = Promise.resolve();
  let lockHeld = false;
  let orderWriteStarted!: () => void;
  let finishOrderWrite!: () => void;
  const orderStarted = new Promise<void>(resolve => { orderWriteStarted = resolve; });
  const finishOrder = new Promise<void>(resolve => { finishOrderWrite = resolve; });
  let orderPersisted = false;
  let archived = false;

  const withQuotaLease = async (_id: string, work: (lease: { assertHeld(): Promise<void> }) => Promise<unknown>) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    lockHeld = true;
    try {
      return await work({ assertHeld: async () => assert.equal(lockHeld, true) });
    } finally {
      lockHeld = false;
      release();
    }
  };
  const service = createRestaurantOrderWriteService({
    Restaurant: { findById: (id: unknown) => {
      assert.equal(String(id), String(restaurantId));
      return { select: () => Promise.resolve(restaurant) };
    } } as any,
    withQuotaLease: withQuotaLease as any
  });

  const orderPromise = service(restaurantId, ownerId, async () => {
    assert.equal(lockHeld, true, "order insertion must remain inside the owner's archive lease");
    orderWriteStarted();
    await finishOrder;
    orderPersisted = true;
    return "created";
  });
  await orderStarted;

  const archivePromise = withQuotaLease(String(ownerId), async lease => {
    await lease.assertHeld();
    assert.equal(orderPersisted, true, "archive must wait for an in-flight order write to finish");
    archived = true;
    restaurant.archivedAt = new Date();
  });
  await Promise.resolve();
  assert.equal(archived, false, "archive must not pass the order write's shared lease");
  finishOrderWrite();
  assert.equal(await orderPromise, "created");
  await archivePromise;
  assert.equal(archived, true);

  await assert.rejects(
    service(restaurantId, ownerId, async () => assert.fail("archived restaurant must not create an order")),
    /not accepting orders/
  );
  assert.equal(orderPersisted, true);
}

run().then(() => console.log("restaurant order write lease tests passed"));
