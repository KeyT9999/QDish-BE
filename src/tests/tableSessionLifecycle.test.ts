import assert from "node:assert/strict";
import mongoose from "mongoose";

import { OrderStatus, PaymentMethod } from "../models/Order.js";
import { TableStatus } from "../models/Table.js";
import { TableSessionStatus } from "../models/TableSession.js";
import {
  closeTableSession,
  getCustomerOrderHistory,
  resolveTableSession
} from "../services/tableSessionLifecycleService.js";

const asObjectId = (value: string) => new mongoose.Types.ObjectId(value.padStart(24, "0"));

const makeDoc = <T extends Record<string, any>>(doc: T) => ({
  ...doc,
  async save() {
    return this;
  },
  toJSON() {
    return { ...this };
  }
});

const ids = {
  restaurant: asObjectId("1"),
  table: asObjectId("2"),
  closedSession: asObjectId("3"),
  openSession: asObjectId("4"),
  order1: asObjectId("5"),
  order2: asObjectId("6")
};

async function testResolveRepairsClosedActiveSession() {
  const table: any = makeDoc({
    _id: ids.table,
    restaurantId: ids.restaurant,
    code: "15",
    isActive: true,
    status: TableStatus.PAYMENT_PENDING,
    activeSessionId: ids.closedSession,
    currentSessionCode: "OLD"
  });

  const closedSession = makeDoc({
    _id: ids.closedSession,
    restaurantId: ids.restaurant,
    tableId: ids.table,
    tableNumber: "15",
    sessionCode: "S1",
    status: TableSessionStatus.PAID,
    openedAt: new Date(),
    totalAmount: 100000,
    orderCount: 1
  });

  const sessions: any[] = [closedSession];

  const deps = {
    Table: {
      findOne: async () => table,
      findByIdAndUpdate: async (_id: any, update: any) => {
        Object.assign(table, update);
        return table;
      }
    },
    TableSession: {
      findById: async (id: any) => sessions.find((session) => session._id.equals(id)) || null,
      findOne: async (filter: any) => sessions.find((session) =>
        session.restaurantId.equals(filter.restaurantId) &&
        session.tableNumber === filter.tableNumber &&
        filter.status.$in.includes(session.status)
      ) || null,
      create: async (payload: any) => {
        const created = makeDoc({ ...payload, _id: ids.openSession });
        sessions.push(created);
        return created;
      }
    }
  };

  const result = await resolveTableSession({
    restaurantId: ids.restaurant.toString(),
    tableNumber: "15"
  }, deps as any);

  assert.equal(result.session._id.toString(), ids.openSession.toString());
  assert.equal(result.session.status, TableSessionStatus.OPEN);
  assert.equal(table.status, TableStatus.OCCUPIED);
  assert.equal(table.activeSessionId.toString(), ids.openSession.toString());
  assert.notEqual(result.session._id.toString(), ids.closedSession.toString());
}

async function testCloseSessionMarksPaidAndReleasesTable() {
  const table: any = makeDoc({
    _id: ids.table,
    code: "15",
    status: TableStatus.OCCUPIED,
    activeSessionId: ids.openSession,
    currentSessionCode: "S2"
  });

  const session = makeDoc({
    _id: ids.openSession,
    restaurantId: ids.restaurant,
    tableId: ids.table,
    tableNumber: "15",
    sessionCode: "S2",
    status: TableSessionStatus.OPEN,
    openedAt: new Date(),
    totalAmount: 0,
    orderCount: 0
  });

  const orders: any[] = [
    makeDoc({
      _id: ids.order1,
      restaurantId: ids.restaurant,
      tableNumber: "15",
      tableSessionId: ids.openSession,
      status: OrderStatus.PENDING,
      totalAmount: 50000
    }),
    makeDoc({
      _id: ids.order2,
      restaurantId: ids.restaurant,
      tableNumber: "15",
      tableSessionId: ids.openSession,
      status: OrderStatus.SERVED,
      totalAmount: 70000
    })
  ];

  const deps = {
    Table: {
      findByIdAndUpdate: async (_id: any, update: any) => {
        Object.assign(table, update);
        return table;
      }
    },
    TableSession: {
      findOne: async () => session
    },
    Order: {
      updateMany: async (_filter: any, update: any) => {
        for (const order of orders) {
          Object.assign(order, update.$set);
        }
      },
      find: async () => orders
    }
  };

  const result = await closeTableSession({
    sessionId: ids.openSession.toString(),
    restaurantId: ids.restaurant.toString(),
    paymentMethod: PaymentMethod.CASH,
    markPaid: true
  }, deps as any);

  assert.equal(result.session.status, TableSessionStatus.PAID);
  assert.ok(result.session.paidAt instanceof Date);
  assert.ok(result.session.closedAt instanceof Date);
  assert.equal(result.session.totalAmount, 120000);
  assert.equal(result.session.orderCount, 2);
  assert.equal(table.status, TableStatus.AVAILABLE);
  assert.equal(table.activeSessionId, null);
  assert.equal(table.currentSessionCode, null);
  assert.ok(table.lastSessionClosedAt instanceof Date);
  assert.deepEqual(orders.map((order) => order.status), [OrderStatus.COMPLETED, OrderStatus.COMPLETED]);
  assert.deepEqual(orders.map((order) => order.paymentMethod), [PaymentMethod.CASH, PaymentMethod.CASH]);
}

async function testCustomerHistoryIsScopedToActiveSession() {
  const sessions = [
    makeDoc({
      _id: ids.closedSession,
      restaurantId: ids.restaurant,
      tableId: ids.table,
      tableNumber: "15",
      sessionCode: "S1",
      status: TableSessionStatus.PAID,
      openedAt: new Date(),
      totalAmount: 50000,
      orderCount: 1
    }),
    makeDoc({
      _id: ids.openSession,
      restaurantId: ids.restaurant,
      tableId: ids.table,
      tableNumber: "15",
      sessionCode: "S2",
      status: TableSessionStatus.OPEN,
      openedAt: new Date(),
      totalAmount: 70000,
      orderCount: 1
    })
  ];

  const orders = [
    makeDoc({
      _id: ids.order1,
      restaurantId: ids.restaurant,
      tableNumber: "15",
      tableSessionId: ids.closedSession,
      status: OrderStatus.COMPLETED,
      totalAmount: 50000
    }),
    makeDoc({
      _id: ids.order2,
      restaurantId: ids.restaurant,
      tableNumber: "15",
      tableSessionId: ids.openSession,
      status: OrderStatus.PENDING,
      totalAmount: 70000
    })
  ];

  const deps = {
    Table: {
      findOne: async () => makeDoc({
        _id: ids.table,
        code: "15",
        activeSessionId: ids.openSession,
        status: TableStatus.OCCUPIED
      }),
      findByIdAndUpdate: async (_id: any, update: any) => update
    },
    TableSession: {
      findById: async (id: any) => sessions.find((session) => session._id.equals(id)) || null,
      findOne: async (filter: any) => sessions.find((session) =>
        session.restaurantId.equals(filter.restaurantId) &&
        session.tableNumber === filter.tableNumber &&
        filter.status.$in.includes(session.status)
      ) || null,
      create: async () => {
        throw new Error("history should not create a session when an active session exists");
      }
    },
    Order: {
      find: async (filter: any) => orders.filter((order) =>
        order.restaurantId.equals(filter.restaurantId) &&
        order.tableNumber === filter.tableNumber &&
        order.tableSessionId.equals(filter.tableSessionId)
      )
    }
  };

  const currentOrders = await getCustomerOrderHistory({
    restaurantId: ids.restaurant.toString(),
    tableNumber: "15"
  }, deps as any);
  assert.deepEqual(currentOrders.map((order: any) => order._id.toString()), [ids.order2.toString()]);

  const closedSessionOrders = await getCustomerOrderHistory({
    restaurantId: ids.restaurant.toString(),
    tableNumber: "15",
    sessionId: ids.closedSession.toString()
  }, deps as any);
  assert.deepEqual(closedSessionOrders, []);
}

async function run() {
  await testResolveRepairsClosedActiveSession();
  await testCloseSessionMarksPaidAndReleasesTable();
  await testCustomerHistoryIsScopedToActiveSession();
  console.log("tableSessionLifecycle regression tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
