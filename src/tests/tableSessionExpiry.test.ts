import assert from "node:assert/strict";
import mongoose from "mongoose";

import { BillStatus } from "../models/Bill.js";
import { TableStatus } from "../models/Table.js";
import { SessionCreatedBy, TableSessionStatus } from "../models/TableSession.js";
import {
  AUTO_EXPIRE_NO_ORDER_REASON,
  TABLE_SESSION_IDLE_TIMEOUT_MS,
  expireIdleTableSession,
  isIdleScanOnlySession
} from "../services/tableSessionExpiryService.js";

const ids = {
  restaurant: new mongoose.Types.ObjectId("000000000000000000000001"),
  table: new mongoose.Types.ObjectId("000000000000000000000002"),
  session: new mongoose.Types.ObjectId("000000000000000000000003"),
  bill: new mongoose.Types.ObjectId("000000000000000000000004"),
  order: new mongoose.Types.ObjectId("000000000000000000000005")
};

const makeDoc = <T extends Record<string, any>>(doc: T) => ({
  ...doc,
  async save() {
    return this;
  },
  toJSON() {
    return { ...this };
  }
});

const createFixture = (now: Date, overrides: Record<string, unknown> = {}) => {
  const session: any = makeDoc({
    _id: ids.session,
    restaurantId: ids.restaurant,
    tableId: ids.table,
    tableNumber: "7",
    sessionCode: "T7-SESSION",
    status: TableSessionStatus.OPEN,
    createdBy: SessionCreatedBy.CUSTOMER_SCAN,
    openedAt: new Date(now.getTime() - TABLE_SESSION_IDLE_TIMEOUT_MS - 1000),
    orderCount: 0,
    totalAmount: 0,
    metadata: {},
    ...overrides
  });
  const table: any = makeDoc({
    _id: ids.table,
    code: "7",
    status: TableStatus.OCCUPIED,
    activeSessionId: ids.session,
    currentSessionCode: session.sessionCode
  });
  const bill: any = makeDoc({
    _id: ids.bill,
    tableSessionId: ids.session,
    status: BillStatus.UNPAID,
    orderIds: [],
    totalAmount: 0
  });
  const orders: any[] = [];

  const matchesSession = (filter: any) => {
    if (filter._id && !String(filter._id).includes(String(session._id))) return false;
    if (filter.status && filter.status !== session.status && !filter.status.$in?.includes(session.status)) return false;
    if (filter.createdBy && filter.createdBy !== session.createdBy) return false;
    if (filter.openedAt?.$lte && session.openedAt > filter.openedAt.$lte) return false;
    if (filter.orderCount === 0 && session.orderCount !== 0) return false;
    return true;
  };

  const deps = {
    now: () => now,
    Restaurant: { findById: async () => ({ ownerId: ids.restaurant }) },
    TableSession: {
      findOne: async (filter: any) => matchesSession(filter) ? session : null,
      findOneAndUpdate: async (filter: any, update: any) => {
        if (!matchesSession(filter)) return null;
        Object.assign(session, update.$set || {});
        return session;
      }
    },
    Order: {
      exists: async (filter: any) => orders.some(order => String(order.tableSessionId) === String(filter.tableSessionId))
    },
    Bill: {
      findOneAndUpdate: async () => {
        if (bill.status !== BillStatus.UNPAID || bill.orderIds.length > 0) return null;
        bill.status = BillStatus.CANCELLED;
        return bill;
      }
    },
    Table: {
      findOneAndUpdate: async (filter: any, update: any) => {
        if (String(filter.activeSessionId) !== String(table.activeSessionId)) return null;
        Object.assign(table, update.$set || {});
        return table;
      }
    },
    withOrderWrite: async (_restaurantId: unknown, _ownerId: unknown, work: () => Promise<unknown>) => work()
  };

  return { session, table, bill, orders, deps };
};

async function testExpiresEmptyScanSessionAndReleasesTable() {
  const now = new Date("2026-09-26T10:00:00.000Z");
  const fixture = createFixture(now);

  const result = await expireIdleTableSession({ sessionId: ids.session }, fixture.deps as any);

  assert.ok(result);
  assert.equal(fixture.session.status, TableSessionStatus.CANCELLED);
  assert.equal(fixture.session.metadata.closeReason, AUTO_EXPIRE_NO_ORDER_REASON);
  assert.equal(fixture.table.status, TableStatus.AVAILABLE);
  assert.equal(fixture.table.activeSessionId, null);
  assert.equal(fixture.table.currentSessionCode, null);
  assert.equal(fixture.bill.status, BillStatus.CANCELLED);
}

async function testDoesNotExpireSessionThatAlreadyHasOrder() {
  const now = new Date("2026-09-26T10:00:00.000Z");
  const fixture = createFixture(now);
  fixture.orders.push({ _id: ids.order, tableSessionId: ids.session });

  const result = await expireIdleTableSession({ sessionId: ids.session }, fixture.deps as any);

  assert.equal(result, null);
  assert.equal(fixture.session.status, TableSessionStatus.OPEN);
  assert.equal(fixture.table.status, TableStatus.OCCUPIED);
  assert.equal(fixture.bill.status, BillStatus.UNPAID);
}

async function testDoesNotExpireBeforeTimeoutAndIsIdempotentAfterExpiry() {
  const now = new Date("2026-09-26T10:00:00.000Z");
  const freshFixture = createFixture(now, {
    openedAt: new Date(now.getTime() - TABLE_SESSION_IDLE_TIMEOUT_MS + 1000)
  });

  assert.equal(isIdleScanOnlySession(freshFixture.session, now), false);
  assert.equal(await expireIdleTableSession({ sessionId: ids.session }, freshFixture.deps as any), null);
  assert.equal(freshFixture.session.status, TableSessionStatus.OPEN);

  const expiredFixture = createFixture(now);
  assert.equal(isIdleScanOnlySession(expiredFixture.session, now), true);
  assert.ok(await expireIdleTableSession({ sessionId: ids.session }, expiredFixture.deps as any));
  assert.equal(await expireIdleTableSession({ sessionId: ids.session }, expiredFixture.deps as any), null);
  assert.equal(expiredFixture.session.status, TableSessionStatus.CANCELLED);
}

async function run() {
  await testExpiresEmptyScanSessionAndReleasesTable();
  await testDoesNotExpireSessionThatAlreadyHasOrder();
  await testDoesNotExpireBeforeTimeoutAndIsIdempotentAfterExpiry();
  console.log("tableSessionExpiry regression tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
