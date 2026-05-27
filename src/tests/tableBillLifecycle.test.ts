import assert from "node:assert/strict";
import mongoose from "mongoose";

import { OrderStatus, PaymentMethod } from "../models/Order.js";
import { TableStatus } from "../models/Table.js";
import { TableSessionStatus } from "../models/TableSession.js";
import { BillPaymentMethod, BillStatus } from "../models/Bill.js";
import {
  appendOrderToBill,
  BillLifecycleError,
  getActiveBillsForRestaurant,
  getCurrentBillForCustomer,
  listBillsForRestaurant,
  payBill,
  resolveActiveBillForSession
} from "../services/billLifecycleService.js";

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
  session: asObjectId("3"),
  bill: asObjectId("4"),
  order1: asObjectId("5"),
  order2: asObjectId("6"),
  paidSession: asObjectId("7"),
  paidBill: asObjectId("8"),
  cancelledSession: asObjectId("9"),
  cancelledBill: asObjectId("10"),
  cancelledOrder: asObjectId("11")
};

const makeState = () => {
  const table: any = makeDoc({
    _id: ids.table,
    restaurantId: ids.restaurant,
    code: "15",
    status: TableStatus.OCCUPIED,
    activeSessionId: ids.session,
    currentSessionCode: "S1"
  });

  const session: any = makeDoc({
    _id: ids.session,
    restaurantId: ids.restaurant,
    tableId: ids.table,
    tableNumber: "15",
    sessionCode: "S1",
    status: TableSessionStatus.OPEN,
    totalAmount: 0,
    orderCount: 0
  });

  const paidSession: any = makeDoc({
    _id: ids.paidSession,
    restaurantId: ids.restaurant,
    tableId: ids.table,
    tableNumber: "15",
    sessionCode: "OLD",
    status: TableSessionStatus.PAID,
    totalAmount: 50000,
    orderCount: 1
  });

  const bills: any[] = [];
  const orders: any[] = [];

  const deps = {
    Bill: {
      findOne: async (filter: any) => bills.find((bill) => {
        if (filter._id && !bill._id.equals(filter._id)) return false;
        if (filter.tableSessionId && !bill.tableSessionId.equals(filter.tableSessionId)) return false;
        if (filter.restaurantId && !bill.restaurantId.equals(filter.restaurantId)) return false;
        if (filter.status?.$in && !filter.status.$in.includes(bill.status)) return false;
        return true;
      }) || null,
      find: (filter: any) => ({
        sort: () => ({
          lean: async () => bills.filter((bill) => {
            if (filter.restaurantId && !bill.restaurantId.equals(filter.restaurantId)) return false;
            if (filter.status?.$in && !filter.status.$in.includes(bill.status)) return false;
            return true;
          })
        })
      }),
      create: async (payload: any) => {
        const created = makeDoc({ ...payload, _id: payload._id || ids.bill });
        bills.push(created);
        return created;
      }
    },
    Order: {
      updateMany: async (filter: any, update: any) => {
        for (const order of orders) {
          if (order.billId.equals(filter.billId) && order.status !== OrderStatus.CANCELLED) {
            Object.assign(order, update.$set);
          }
        }
      },
      find: (filter: any) => ({
        sort: () => ({
          lean: async () => orders.filter((order) => {
            if (filter.$or) {
              return filter.$or.some((candidate: any) => {
                if (candidate.tableSessionId && !order.tableSessionId.equals(candidate.tableSessionId)) {
                  return false;
                }
                if (candidate.billId?.$exists === false) {
                  return order.billId === undefined;
                }
                if (candidate.billId === null) {
                  return order.billId === null;
                }
                if (candidate.billId && (!order.billId || !order.billId.equals(candidate.billId))) return false;
                return true;
              });
            }
            if (filter.billId && !order.billId.equals(filter.billId)) return false;
            if (filter.tableSessionId && !order.tableSessionId.equals(filter.tableSessionId)) return false;
            return true;
          })
        })
      })
    },
    TableSession: {
      findById: async (id: any) => [session, paidSession].find((item) => item._id.equals(id)) || null,
      findOne: async (filter: any) => [session, paidSession].find((item) => {
        if (filter._id && !item._id.equals(filter._id)) return false;
        if (filter.restaurantId && !item.restaurantId.equals(filter.restaurantId)) return false;
        return true;
      }) || null
    },
    Table: {
      findByIdAndUpdate: async (_id: any, update: any) => {
        Object.assign(table, update);
        return table;
      }
    }
  };

  return { bills, deps, orders, paidSession, session, table };
};

async function testOrdersAccumulateIntoOneBill() {
  const { bills, deps, orders, session } = makeState();

  const bill = await resolveActiveBillForSession(session, deps as any);
  assert.equal(bill.status, BillStatus.UNPAID);
  assert.equal(session.billId.toString(), ids.bill.toString());

  const order1: any = makeDoc({
    _id: ids.order1,
    restaurantId: ids.restaurant,
    tableSessionId: ids.session,
    tableNumber: "15",
    items: [{ menuItemId: "rice", name: "Com ga", price: 50000, quantity: 1 }],
    totalAmount: 50000,
    status: OrderStatus.PENDING
  });
  orders.push(order1);

  await appendOrderToBill(order1, session, deps as any);

  const order2: any = makeDoc({
    _id: ids.order2,
    restaurantId: ids.restaurant,
    tableSessionId: ids.session,
    tableNumber: "15",
    items: [{ menuItemId: "tea", name: "Tra dao", price: 35000, quantity: 2 }],
    totalAmount: 70000,
    status: OrderStatus.PENDING
  });
  orders.push(order2);

  await appendOrderToBill(order2, session, deps as any);

  assert.equal(bills.length, 1);
  assert.deepEqual(bill.orderIds.map((id: any) => id.toString()), [ids.order1.toString(), ids.order2.toString()]);
  assert.equal(bill.totalItems, 3);
  assert.equal(bill.subtotal, 120000);
  assert.equal(bill.totalAmount, 120000);
  assert.equal(session.orderCount, 2);
  assert.equal(session.totalAmount, 120000);
  assert.equal(order1.billId.toString(), ids.bill.toString());
  assert.equal(order2.billId.toString(), ids.bill.toString());
}

async function testPayBillClosesSessionAndReleasesTable() {
  const { deps, orders, session, table } = makeState();
  const bill = await resolveActiveBillForSession(session, deps as any);

  const order1: any = makeDoc({
    _id: ids.order1,
    restaurantId: ids.restaurant,
    tableSessionId: ids.session,
    tableNumber: "15",
    items: [{ menuItemId: "rice", name: "Com ga", price: 50000, quantity: 1 }],
    totalAmount: 50000,
    status: OrderStatus.PENDING
  });
  orders.push(order1);
  await appendOrderToBill(order1, session, deps as any);

  const result = await payBill({
    billId: bill._id.toString(),
    restaurantId: ids.restaurant.toString(),
    paymentMethod: BillPaymentMethod.CASH,
    cashReceived: 100000
  }, deps as any);

  assert.equal(result.bill.status, BillStatus.PAID);
  assert.equal(result.bill.paymentMethod, BillPaymentMethod.CASH);
  assert.equal(result.bill.cashReceived, 100000);
  assert.equal(result.bill.changeAmount, 50000);
  assert.ok(result.bill.paidAt instanceof Date);
  assert.equal(order1.status, OrderStatus.COMPLETED);
  assert.equal(order1.paymentMethod, PaymentMethod.CASH);
  assert.equal(session.status, TableSessionStatus.PAID);
  assert.ok(session.closedAt instanceof Date);
  assert.equal(table.status, TableStatus.AVAILABLE);
  assert.equal(table.activeSessionId, null);

  const secondResult = await payBill({
    billId: bill._id.toString(),
    restaurantId: ids.restaurant.toString(),
    paymentMethod: BillPaymentMethod.BANK_TRANSFER
  }, deps as any);

  assert.equal(secondResult.alreadyPaid, true);
  assert.equal(secondResult.bill.paymentMethod, BillPaymentMethod.CASH);
}

async function testCustomerCannotReadPaidBillAsCurrent() {
  const { bills, deps, paidSession } = makeState();
  const paidBill: any = makeDoc({
    _id: ids.paidBill,
    restaurantId: ids.restaurant,
    tableSessionId: ids.paidSession,
    tableNumber: "15",
    billCode: "B-OLD",
    status: BillStatus.PAID,
    orderIds: [],
    itemsSnapshot: [],
    subtotal: 50000,
    discountAmount: 0,
    serviceFee: 0,
    taxAmount: 0,
    totalAmount: 50000,
    totalItems: 1
  });
  paidSession.billId = paidBill._id;
  bills.push(paidBill);

  const current = await getCurrentBillForCustomer({
    restaurantId: ids.restaurant.toString(),
    tableNumber: "15",
    sessionId: ids.paidSession.toString()
  }, deps as any);

  assert.equal(current.session, null);
  assert.equal(current.bill, null);
  assert.deepEqual(current.orders, []);
}

async function testCashPaymentRejectsInsufficientReceivedAmount() {
  const { deps, orders, session } = makeState();
  const bill = await resolveActiveBillForSession(session, deps as any);

  const order1: any = makeDoc({
    _id: ids.order1,
    restaurantId: ids.restaurant,
    tableSessionId: ids.session,
    tableNumber: "15",
    items: [{ menuItemId: "rice", name: "Com ga", price: 50000, quantity: 1 }],
    totalAmount: 50000,
    status: OrderStatus.SERVED
  });
  orders.push(order1);
  await appendOrderToBill(order1, session, deps as any);

  await assert.rejects(
    () => payBill({
      billId: bill._id.toString(),
      restaurantId: ids.restaurant.toString(),
      paymentMethod: BillPaymentMethod.CASH,
      cashReceived: 30000
    }, deps as any),
    (error: any) => (
      error instanceof BillLifecycleError &&
      error.statusCode === 400 &&
      error.message.includes("Tien khach dua")
    )
  );

  assert.equal(bill.status, BillStatus.UNPAID);
  assert.equal(order1.status, OrderStatus.SERVED);
}

async function testBankTransferPaymentDoesNotRequireCashReceived() {
  const { deps, orders, session } = makeState();
  const bill = await resolveActiveBillForSession(session, deps as any);

  const order1: any = makeDoc({
    _id: ids.order1,
    restaurantId: ids.restaurant,
    tableSessionId: ids.session,
    tableNumber: "15",
    items: [{ menuItemId: "tea", name: "Tra dao", price: 35000, quantity: 1 }],
    totalAmount: 35000,
    status: OrderStatus.SERVED
  });
  orders.push(order1);
  await appendOrderToBill(order1, session, deps as any);

  const result = await payBill({
    billId: bill._id.toString(),
    restaurantId: ids.restaurant.toString(),
    paymentMethod: BillPaymentMethod.BANK_TRANSFER
  }, deps as any);

  assert.equal(result.bill.status, BillStatus.PAID);
  assert.equal(result.bill.paymentMethod, BillPaymentMethod.BANK_TRANSFER);
  assert.equal(result.bill.cashReceived, undefined);
  assert.equal(result.bill.changeAmount, undefined);
  assert.equal(order1.paymentMethod, PaymentMethod.BANK_TRANSFER);
}

async function testActiveBillsGroupOrdersAtBillLevel() {
  const { deps, orders, session } = makeState();
  const bill = await resolveActiveBillForSession(session, deps as any);

  const order1: any = makeDoc({
    _id: ids.order1,
    restaurantId: ids.restaurant,
    tableSessionId: ids.session,
    billId: bill._id,
    tableNumber: "15",
    items: [{ menuItemId: "rice", name: "Com uc ga", price: 50000, quantity: 1 }],
    totalAmount: 50000,
    status: OrderStatus.SERVED,
    createdAt: new Date("2026-05-27T00:06:00.000Z")
  });
  const order2: any = makeDoc({
    _id: ids.order2,
    restaurantId: ids.restaurant,
    tableSessionId: ids.session,
    billId: bill._id,
    tableNumber: "15",
    items: [{ menuItemId: "rice", name: "Com uc ga", price: 50000, quantity: 1 }],
    totalAmount: 50000,
    status: OrderStatus.SERVED,
    createdAt: new Date("2026-05-27T00:07:00.000Z")
  });
  orders.push(order1, order2);
  await appendOrderToBill(order1, session, deps as any);
  await appendOrderToBill(order2, session, deps as any);

  const activeBills = await getActiveBillsForRestaurant({
    restaurantId: ids.restaurant.toString()
  }, deps as any);

  assert.equal(activeBills.length, 1);
  assert.equal(activeBills[0].billId.toString(), bill._id.toString());
  assert.equal(activeBills[0].billCode, bill.billCode);
  assert.equal(activeBills[0].tableNumber, "15");
  assert.equal(activeBills[0].sessionCode, "S1");
  assert.equal(activeBills[0].orderCount, 2);
  assert.equal(activeBills[0].totalItems, 2);
  assert.equal(activeBills[0].totalAmount, 100000);
  assert.equal(activeBills[0].orders.length, 2);
}

async function testBillListFiltersIncludeOperationalAndHistoricalStatuses() {
  const { bills, deps, orders, session } = makeState();
  const bill = await resolveActiveBillForSession(session, deps as any);

  const order1: any = makeDoc({
    _id: ids.order1,
    restaurantId: ids.restaurant,
    tableSessionId: ids.session,
    billId: bill._id,
    tableNumber: "15",
    items: [{ menuItemId: "rice", name: "Com uc ga", price: 50000, quantity: 1 }],
    totalAmount: 50000,
    status: OrderStatus.PENDING,
    createdAt: new Date("2026-05-27T00:06:00.000Z")
  });
  orders.push(order1);
  await appendOrderToBill(order1, session, deps as any);

  const pending = await listBillsForRestaurant({
    restaurantId: ids.restaurant.toString(),
    status: OrderStatus.PENDING
  }, deps as any);
  assert.equal(pending.bills.length, 1);
  assert.equal(pending.bills[0].orders[0].status, OrderStatus.PENDING);

  order1.status = OrderStatus.CONFIRMED;
  const confirmed = await listBillsForRestaurant({
    restaurantId: ids.restaurant.toString(),
    status: OrderStatus.CONFIRMED
  }, deps as any);
  assert.equal(confirmed.bills.length, 1);
  assert.equal(confirmed.bills[0].billId.toString(), bill._id.toString());

  order1.status = OrderStatus.SERVED;
  const served = await listBillsForRestaurant({
    restaurantId: ids.restaurant.toString(),
    status: OrderStatus.SERVED
  }, deps as any);
  assert.equal(served.bills.length, 1);
  assert.equal(served.bills[0].status, BillStatus.UNPAID);

  await payBill({
    billId: bill._id.toString(),
    restaurantId: ids.restaurant.toString(),
    paymentMethod: BillPaymentMethod.CASH,
    cashReceived: 50000
  }, deps as any);

  const completed = await listBillsForRestaurant({
    restaurantId: ids.restaurant.toString(),
    status: "COMPLETED"
  }, deps as any);
  assert.equal(completed.bills.length, 1);
  assert.equal(completed.bills[0].status, BillStatus.PAID);

  const activeAfterPay = await getActiveBillsForRestaurant({
    restaurantId: ids.restaurant.toString()
  }, deps as any);
  assert.equal(activeAfterPay.length, 0);

  const cancelledBill: any = makeDoc({
    _id: ids.cancelledBill,
    restaurantId: ids.restaurant,
    tableSessionId: ids.cancelledSession,
    tableNumber: "16",
    billCode: "B-CANCELLED",
    status: BillStatus.CANCELLED,
    orderIds: [ids.cancelledOrder],
    itemsSnapshot: [],
    subtotal: 0,
    discountAmount: 0,
    serviceFee: 0,
    taxAmount: 0,
    totalAmount: 0,
    totalItems: 0
  });
  bills.push(cancelledBill);
  orders.push(makeDoc({
    _id: ids.cancelledOrder,
    restaurantId: ids.restaurant,
    tableSessionId: ids.cancelledSession,
    billId: ids.cancelledBill,
    tableNumber: "16",
    items: [{ menuItemId: "tea", name: "Tra dao", price: 35000, quantity: 1 }],
    totalAmount: 35000,
    status: OrderStatus.CANCELLED
  }));

  const cancelled = await listBillsForRestaurant({
    restaurantId: ids.restaurant.toString(),
    status: OrderStatus.CANCELLED
  }, deps as any);
  assert.equal(cancelled.bills.length, 1);
  assert.equal(cancelled.bills[0].billId.toString(), ids.cancelledBill.toString());
}

async function run() {
  await testOrdersAccumulateIntoOneBill();
  await testPayBillClosesSessionAndReleasesTable();
  await testCashPaymentRejectsInsufficientReceivedAmount();
  await testBankTransferPaymentDoesNotRequireCashReceived();
  await testCustomerCannotReadPaidBillAsCurrent();
  await testActiveBillsGroupOrdersAtBillLevel();
  await testBillListFiltersIncludeOperationalAndHistoricalStatuses();
  console.log("tableBillLifecycle regression tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
