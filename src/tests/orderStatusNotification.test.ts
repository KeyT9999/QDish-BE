import assert from "node:assert/strict";
import { OrderStatus } from "../models/Order.js";
import { createOrderStatusNotificationScheduler } from "../services/orderStatusNotificationService.js";

async function run() {
  const jobs: Array<() => Promise<void>> = [];
  const notifications: Array<Record<string, any>> = [];
  let staffLookups = 0;
  let ownerLookups = 0;

  const schedule = createOrderStatusNotificationScheduler({
    schedule: (job) => jobs.push(job),
    findStaffUserIds: async () => {
      staffLookups += 1;
      return ["actor-1", "staff-2", "staff-2"];
    },
    resolveOwnerId: async () => {
      ownerLookups += 1;
      return "owner-3";
    },
    createSystemNotification: async (input) => {
      notifications.push(input);
    },
    logError: () => assert.fail("unexpected notification failure")
  });

  schedule({
    restaurantId: "restaurant-1",
    orderId: "order-1",
    tableNumber: "Bàn 4",
    status: OrderStatus.SERVED,
    updatedByName: "Bếp A",
    actorUserId: "actor-1"
  });

  assert.equal(jobs.length, 1, "status handling should enqueue notification work without running database lookups inline");
  assert.equal(staffLookups, 0);
  assert.equal(ownerLookups, 0);

  await jobs[0]();

  assert.equal(staffLookups, 1);
  assert.equal(ownerLookups, 1);
  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0].recipientUserIds, ["staff-2", "owner-3"]);
  assert.equal(notifications[0].message, "Đơn hàng bàn Bàn 4 đã ra món bởi Bếp A");
  assert.equal(notifications[0].orderId, "order-1");

  const actorOnlySchedule = createOrderStatusNotificationScheduler({
    schedule: (job) => jobs.push(job),
    findStaffUserIds: async () => ["actor-1"],
    resolveOwnerId: async () => "actor-1",
    createSystemNotification: async (input) => {
      notifications.push(input);
    },
    logError: () => assert.fail("unexpected notification failure")
  });
  actorOnlySchedule({
    restaurantId: "restaurant-1",
    orderId: "order-2",
    tableNumber: "Bàn 1",
    status: OrderStatus.SERVED,
    updatedByName: "",
    actorUserId: "actor-1"
  });
  await jobs[1]();
  assert.equal(notifications.length, 1, "the user who performed the action must not receive a duplicate success toast");

  let loggedErrors = 0;
  const failingSchedule = createOrderStatusNotificationScheduler({
    schedule: (job) => jobs.push(job),
    findStaffUserIds: async () => { throw new Error("offline"); },
    resolveOwnerId: async () => null,
    createSystemNotification: async () => assert.fail("must not notify after recipient lookup fails"),
    logError: () => { loggedErrors += 1; }
  });
  failingSchedule({
    restaurantId: "restaurant-1",
    orderId: "order-3",
    tableNumber: "Bàn 2",
    status: OrderStatus.SERVED,
    updatedByName: "Bếp B",
    actorUserId: "actor-2"
  });
  await jobs[2]();
  assert.equal(loggedErrors, 1, "background notification errors must be logged without affecting the order response");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
