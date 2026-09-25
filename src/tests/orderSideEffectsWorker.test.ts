import assert from "node:assert/strict";
import mongoose from "mongoose";
import { Order, OrderStatus } from "../models/Order.js";
import { createOrderSideEffectsWorker } from "../services/orderSideEffectsWorker.js";

const makeOrder: () => any = () => ({
  _id: new mongoose.Types.ObjectId(),
  restaurantId: new mongoose.Types.ObjectId(),
  tableNumber: "Bàn 4",
  totalAmount: 125_000,
  items: [{ name: "Bowl", price: 125_000, quantity: 1 }],
  createdAt: new Date("2026-09-25T10:00:00.000Z"),
  note: undefined,
  sideEffects: {
    status: "pending",
    requestId: "req-test-1",
    billLinkAttempts: 0,
    nextAttemptAt: new Date(),
    notification: { status: "pending", attempts: 0 },
    email: { status: "pending", attempts: 0 },
    customerStats: {
      status: "pending",
      attempts: 0,
      customerId: new mongoose.Types.ObjectId(),
      sessionWasLinked: true
    }
  }
});

async function run() {
  const responseModel = new Order({
    restaurantId: new mongoose.Types.ObjectId(),
    tableNumber: "Bàn 1",
    items: [{ menuItemId: "menu-1", name: "Bowl", price: 125_000, quantity: 1 }],
    totalAmount: 125_000,
    status: OrderStatus.PENDING,
    sideEffects: makeOrder().sideEffects
  });
  assert.equal("sideEffects" in responseModel.toJSON(), false, "internal outbox data must not leak through API/socket order JSON");

  const order = makeOrder();
  let claimAvailable = true;
  const updates: Array<Record<string, unknown>> = [];
  let notificationKey = "";
  let emailMessageId = "";
  let statsOrderId = "";
  const worker = createOrderSideEffectsWorker({
    Order: {
      findOneAndUpdate: async () => {
        if (!claimAvailable) return null;
        claimAvailable = false;
        return order;
      },
      updateOne: async (_filter: unknown, update: any) => {
        updates.push(update);
        for (const [key, value] of Object.entries(update.$set || {})) {
          const path = key.split(".");
          let cursor: any = order;
          while (path.length > 1) cursor = cursor[path.shift()!];
          cursor[path[0]] = value;
        }
      }
    } as any,
    Restaurant: { findById: async () => ({ name: "Kurumi", ownerName: "Owner", email: "owner@example.test" }) } as any,
    User: { find: async () => [{ _id: new mongoose.Types.ObjectId() }] } as any,
    createSystemNotification: async (input: any) => { notificationKey = input.idempotencyKey; return null; },
    sendNewOrderNotification: async (input: any) => { emailMessageId = input.messageId; },
    recordCustomerOrder: async (_customerId: unknown, _amount: number, _linked: boolean, orderId?: string) => { statsOrderId = orderId || ""; }
  });

  assert.equal(await worker.runOnce(), true);
  assert.equal(await worker.runOnce(), false);
  assert.equal(notificationKey, `order-notification:${order._id}`);
  assert.equal(emailMessageId, `<qdish-order-${order._id}@notifications.qdish>`);
  assert.equal(statsOrderId, order._id.toString());
  assert.equal(order.sideEffects.status, "completed");
  assert.equal(order.sideEffects.notification.status, "completed");
  assert.equal(order.sideEffects.email.status, "completed");
  assert.equal(order.sideEffects.customerStats.status, "completed");
  assert.ok(updates.length >= 4, "persist task progress individually so completed work is not repeated after restart");

  const retryOrder = makeOrder();
  let retryClaimAvailable = true;
  let notificationAttempts = 0;
  let emailAttempts = 0;
  let statsAttempts = 0;
  const retryWorker = createOrderSideEffectsWorker({
    Order: {
      findOneAndUpdate: async () => {
        if (!retryClaimAvailable) return null;
        retryClaimAvailable = false;
        return retryOrder;
      },
      updateOne: async (_filter: unknown, update: any) => {
        for (const [key, value] of Object.entries(update.$set || {})) {
          const path = key.split(".");
          let cursor: any = retryOrder;
          while (path.length > 1) cursor = cursor[path.shift()!];
          cursor[path[0]] = value;
        }
        for (const [key, value] of Object.entries(update.$inc || {})) {
          const path = key.split(".");
          let cursor: any = retryOrder;
          while (path.length > 1) cursor = cursor[path.shift()!];
          cursor[path[0]] += value as number;
        }
      }
    } as any,
    Restaurant: { findById: async () => ({ name: "Kurumi", ownerName: "Owner", email: "owner@example.test" }) } as any,
    User: { find: async () => [{ _id: new mongoose.Types.ObjectId() }] } as any,
    createSystemNotification: async () => {
      notificationAttempts += 1;
      if (notificationAttempts === 1) throw new Error("temporary provider failure");
      return null;
    },
    sendNewOrderNotification: async () => { emailAttempts += 1; },
    recordCustomerOrder: async () => { statsAttempts += 1; }
  });

  assert.equal(await retryWorker.runOnce(), true);
  assert.equal(retryOrder.sideEffects.status, "retry");
  assert.equal(retryOrder.sideEffects.notification.status, "pending");
  assert.equal(retryOrder.sideEffects.email.status, "completed");
  assert.equal(retryOrder.sideEffects.customerStats.status, "completed");
  assert.equal(retryOrder.sideEffects.notification.attempts, 1);
  assert.ok(retryOrder.sideEffects.nextAttemptAt instanceof Date);
  retryOrder.sideEffects.nextAttemptAt = new Date(0);
  retryOrder.sideEffects.status = "retry";
  retryClaimAvailable = true;

  assert.equal(await retryWorker.runOnce(), true);
  assert.equal(retryOrder.sideEffects.status, "completed");
  assert.equal(notificationAttempts, 2, "retry only the failed effect");
  assert.equal(emailAttempts, 1);
  assert.equal(statsAttempts, 1);

  const billPendingOrder = makeOrder();
  billPendingOrder.billId = new mongoose.Types.ObjectId();
  let billIsLinked = false;
  let billPendingClaimAvailable = true;
  let billPendingNotifications = 0;
  const billGuardWorker = createOrderSideEffectsWorker({
    Order: {
      findOneAndUpdate: async () => {
        if (!billPendingClaimAvailable) return null;
        billPendingClaimAvailable = false;
        return billPendingOrder;
      },
      updateOne: async (_filter: unknown, update: any) => {
        for (const [key, value] of Object.entries(update.$set || {})) {
          const path = key.split(".");
          let cursor: any = billPendingOrder;
          while (path.length > 1) cursor = cursor[path.shift()!];
          cursor[path[0]] = value;
        }
      }
    } as any,
    Bill: { exists: async () => billIsLinked } as any,
    Restaurant: { findById: async () => null } as any,
    User: { find: async () => [{ _id: new mongoose.Types.ObjectId() }] } as any,
    createSystemNotification: async () => { billPendingNotifications += 1; return null; },
    recordCustomerOrder: async () => {}
  });

  assert.equal(await billGuardWorker.runOnce(), true);
  assert.equal(billPendingOrder.sideEffects.status, "retry");
  assert.equal(billPendingNotifications, 0, "don't announce an order before its bill includes it");
  billIsLinked = true;
  billPendingOrder.sideEffects.nextAttemptAt = new Date(0);
  billPendingClaimAvailable = true;
  assert.equal(await billGuardWorker.runOnce(), true);
  assert.equal(billPendingNotifications, 1);

  const terminalBillOrder = makeOrder();
  terminalBillOrder.billId = new mongoose.Types.ObjectId();
  terminalBillOrder.sideEffects.billLinkAttempts = 7;
  const terminalBillWorker = createOrderSideEffectsWorker({
    Order: {
      findOneAndUpdate: async () => terminalBillOrder,
      updateOne: async (_filter: unknown, update: any) => {
        Object.assign(terminalBillOrder.sideEffects, Object.fromEntries(
          Object.entries(update.$set || {}).map(([key, value]) => [key.replace("sideEffects.", ""), value])
        ));
      }
    } as any,
    Bill: { exists: async () => false } as any
  });
  assert.equal(await terminalBillWorker.runOnce(), true);
  assert.equal(terminalBillOrder.sideEffects.status, "failed");
  assert.equal(terminalBillOrder.sideEffects.billLinkAttempts, 8, "unlinked bills must stop retrying after the poison-job limit");
  assert.equal(terminalBillOrder.sideEffects.lastErrorCode, "BILL_ORDER_LINK_MISSING");

  console.log("order side-effect worker tests passed");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
