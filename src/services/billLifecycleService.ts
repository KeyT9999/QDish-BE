import mongoose, { Types } from "mongoose";

import { Bill, BillPaymentMethod, BillStatus, generateBillCode } from "../models/Bill.js";
import { Order, OrderStatus, PaymentMethod } from "../models/Order.js";
import { Table, TableStatus } from "../models/Table.js";
import { TableSession, TableSessionStatus } from "../models/TableSession.js";

export const ACTIVE_BILL_STATUSES = [
  BillStatus.UNPAID,
  BillStatus.PAYMENT_REQUESTED
];

export const ACTIVE_SESSION_STATUSES = [
  TableSessionStatus.OPEN,
  TableSessionStatus.PAYMENT_REQUESTED
];

export class BillLifecycleError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

type BillLifecycleDeps = {
  Bill: any;
  Order: any;
  TableSession: any;
  Table: any;
};

export type BillListStatus =
  | "ALL"
  | OrderStatus.PENDING
  | OrderStatus.CONFIRMED
  | OrderStatus.SERVED
  | OrderStatus.COMPLETED
  | OrderStatus.CANCELLED
  | BillStatus.UNPAID
  | BillStatus.PAYMENT_REQUESTED
  | BillStatus.PAID
  | BillStatus.CANCELLED;

const defaultDeps: BillLifecycleDeps = {
  Bill,
  Order,
  TableSession,
  Table
};

const toObjectId = (value: string | Types.ObjectId, fieldName: string) => {
  if (value instanceof Types.ObjectId) return value;
  if (!mongoose.isValidObjectId(value)) {
    throw new BillLifecycleError(400, `${fieldName} khong hop le`);
  }
  return new Types.ObjectId(value);
};

const sameId = (left: unknown, right: unknown) => {
  if (!left || !right) return false;
  return left.toString() === right.toString();
};

const isActiveSession = (status?: string) => (
  status === TableSessionStatus.OPEN || status === TableSessionStatus.PAYMENT_REQUESTED
);

const isActiveBill = (status?: string) => (
  status === BillStatus.UNPAID || status === BillStatus.PAYMENT_REQUESTED
);

const normalizeBillPaymentMethod = (method?: string) => {
  if (!method) {
    throw new BillLifecycleError(400, "Vui long chon hinh thuc thanh toan");
  }
  if (Object.values(BillPaymentMethod).includes(method as BillPaymentMethod)) {
    return method as BillPaymentMethod;
  }
  throw new BillLifecycleError(400, "Hinh thuc thanh toan khong hop le");
};

const validateRestaurantPaymentMethod = (method: BillPaymentMethod) => {
  if (method !== BillPaymentMethod.CASH && method !== BillPaymentMethod.BANK_TRANSFER) {
    throw new BillLifecycleError(400, "Bill tai ban chi ho tro tien mat hoac chuyen khoan");
  }
};

const normalizeCashReceived = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    throw new BillLifecycleError(400, "Tien khach dua la bat buoc khi thanh toan tien mat");
  }

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new BillLifecycleError(400, "Tien khach dua khong hop le");
  }

  return amount;
};

const mapBillPaymentToOrderPayment = (method: BillPaymentMethod) => {
  switch (method) {
    case BillPaymentMethod.CASH:
      return PaymentMethod.CASH;
    case BillPaymentMethod.BANK_TRANSFER:
      return PaymentMethod.BANK_TRANSFER;
    case BillPaymentMethod.PAYOS:
      return PaymentMethod.PAYOS;
    default:
      return PaymentMethod.UNKNOWN;
  }
};

const fetchOrders = async (deps: BillLifecycleDeps, filter: Record<string, unknown>) => {
  const queryOrDocs = deps.Order.find(filter);
  if (typeof queryOrDocs?.sort === "function") {
    const sorted = queryOrDocs.sort({ createdAt: -1 });
    return typeof sorted?.lean === "function" ? sorted.lean() : sorted;
  }
  return queryOrDocs;
};

const fetchBills = async (deps: BillLifecycleDeps, filter: Record<string, unknown>) => {
  const queryOrDocs = deps.Bill.find(filter);
  if (typeof queryOrDocs?.sort === "function") {
    const sorted = queryOrDocs.sort({ createdAt: -1 });
    return typeof sorted?.lean === "function" ? sorted.lean() : sorted;
  }
  return queryOrDocs;
};

const fetchSessionById = async (deps: BillLifecycleDeps, sessionId: unknown) => {
  if (!sessionId || typeof deps.TableSession.findById !== "function") {
    return null;
  }
  const queryOrDoc = deps.TableSession.findById(sessionId);
  if (typeof queryOrDoc?.lean === "function") {
    return queryOrDoc.lean();
  }
  return queryOrDoc;
};

const fetchOrdersForBill = async (deps: BillLifecycleDeps, bill: any) => fetchOrders(deps, {
  $or: [
    { billId: bill._id },
    {
      tableSessionId: bill.tableSessionId,
      billId: { $exists: false }
    },
    {
      tableSessionId: bill.tableSessionId,
      billId: null
    }
  ]
});

const buildBillGroup = async (deps: BillLifecycleDeps, bill: any) => {
  const session = await fetchSessionById(deps, bill.tableSessionId);
  const orders = await fetchOrdersForBill(deps, bill);
  const payableOrders = orders.filter((order: any) => order.status !== OrderStatus.CANCELLED);
  const ordersTotal = payableOrders.reduce((sum: number, order: any) => sum + (Number(order.totalAmount) || 0), 0);
  const ordersItems = payableOrders.reduce((sum: number, order: any) => (
    sum + (order.items || []).reduce((itemSum: number, item: any) => itemSum + (Number(item.quantity) || 0), 0)
  ), 0);

  return {
    billId: bill._id,
    billCode: bill.billCode,
    tableNumber: bill.tableNumber,
    tableSessionId: bill.tableSessionId,
    sessionCode: session?.sessionCode,
    sessionStatus: session?.status,
    status: bill.status,
    totalAmount: Number(bill.totalAmount) > 0 ? Number(bill.totalAmount) : ordersTotal,
    totalItems: Number(bill.totalItems) > 0 ? Number(bill.totalItems) : ordersItems,
    orderCount: payableOrders.length,
    paymentMethod: bill.paymentMethod,
    paidAt: bill.paidAt,
    createdAt: bill.createdAt,
    updatedAt: bill.updatedAt,
    orders: orders.map((order: any) => ({
      id: order.id || order._id,
      _id: order._id,
      orderCode: `#${String(order.id || order._id || "").slice(-6).toUpperCase()}`,
      restaurantId: order.restaurantId,
      tableNumber: order.tableNumber,
      tableSessionId: order.tableSessionId,
      billId: order.billId || bill._id,
      billCode: bill.billCode,
      billStatus: bill.status,
      sessionCode: order.sessionCode || session?.sessionCode,
      items: order.items || [],
      totalAmount: order.totalAmount,
      status: order.status,
      note: order.note,
      customerName: order.customerName,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      timestamp: order.timestamp
    }))
  };
};

const normalizeListStatus = (status?: string) => (status || "ALL").toUpperCase();

const billGroupMatchesStatus = (group: any, status?: string) => {
  const normalized = normalizeListStatus(status);
  const orders = group.orders || [];

  if (normalized === "ALL") return true;
  if (normalized === BillStatus.UNPAID) return group.status === BillStatus.UNPAID;
  if (normalized === BillStatus.PAYMENT_REQUESTED) return group.status === BillStatus.PAYMENT_REQUESTED;
  if (normalized === BillStatus.PAID) return group.status === BillStatus.PAID;

  if (normalized === OrderStatus.PENDING) {
    return orders.some((order: any) => order.status === OrderStatus.PENDING);
  }

  if (normalized === OrderStatus.CONFIRMED) {
    return orders.some((order: any) => order.status === OrderStatus.CONFIRMED);
  }

  if (normalized === OrderStatus.SERVED) {
    return group.status !== BillStatus.PAID
      && group.status !== BillStatus.CANCELLED
      && orders.some((order: any) => order.status === OrderStatus.SERVED);
  }

  if (normalized === OrderStatus.COMPLETED || normalized === "COMPLETED") {
    return group.status === BillStatus.PAID
      || group.sessionStatus === TableSessionStatus.PAID
      || group.sessionStatus === TableSessionStatus.CLOSED;
  }

  if (normalized === OrderStatus.CANCELLED || normalized === BillStatus.CANCELLED) {
    return group.status === BillStatus.CANCELLED
      || group.sessionStatus === TableSessionStatus.CANCELLED
      || (orders.length > 0 && orders.every((order: any) => order.status === OrderStatus.CANCELLED));
  }

  return false;
};

const billGroupMatchesSearch = (group: any, search?: string) => {
  const searchLower = (search || "").trim().toLowerCase();
  if (!searchLower) return true;

  const billFields = [
    group.billCode,
    group.tableNumber,
    group.sessionCode,
    group.status
  ].map((value) => String(value || "").toLowerCase());

  if (billFields.some((value) => value.includes(searchLower))) {
    return true;
  }

  return (group.orders || []).some((order: any) => {
    const orderId = String(order.id || order._id || "").toLowerCase();
    const customer = String(order.customerName || "").toLowerCase();
    const note = String(order.note || "").toLowerCase();
    const items = (order.items || []).map((item: any) => item.name).join(" ").toLowerCase();
    return orderId.includes(searchLower)
      || customer.includes(searchLower)
      || note.includes(searchLower)
      || items.includes(searchLower);
  });
};

const recomputeBillTotals = (bill: any) => {
  bill.totalItems = bill.itemsSnapshot.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0), 0);
  bill.subtotal = bill.itemsSnapshot.reduce((sum: number, item: any) => sum + (Number(item.totalPrice) || 0), 0);
  bill.discountAmount = Number(bill.discountAmount) || 0;
  bill.serviceFee = Number(bill.serviceFee) || 0;
  bill.taxAmount = Number(bill.taxAmount) || 0;
  bill.totalAmount = Math.max(0, bill.subtotal - bill.discountAmount + bill.serviceFee + bill.taxAmount);
};

const setSessionBill = async (session: any, bill: any) => {
  if (!sameId(session.billId, bill._id)) {
    session.billId = bill._id;
    if (typeof session.save === "function") {
      await session.save();
    }
  }
};

export const resolveActiveBillForSession = async (
  session: any,
  deps: BillLifecycleDeps = defaultDeps
) => {
  if (!session || !isActiveSession(session.status)) {
    throw new BillLifecycleError(400, "Phien ban khong con mo");
  }

  if (session.billId) {
    const billById = await deps.Bill.findOne({
      _id: session.billId,
      restaurantId: session.restaurantId,
      status: { $in: ACTIVE_BILL_STATUSES }
    });
    if (billById) return billById;
  }

  const existingBill = await deps.Bill.findOne({
    restaurantId: session.restaurantId,
    tableSessionId: session._id,
    status: { $in: ACTIVE_BILL_STATUSES }
  });
  if (existingBill) {
    await setSessionBill(session, existingBill);
    return existingBill;
  }

  let bill: any;
  try {
    bill = await deps.Bill.create({
      restaurantId: session.restaurantId,
      tableSessionId: session._id,
      tableNumber: session.tableNumber,
      billCode: generateBillCode(session.tableNumber),
      status: BillStatus.UNPAID,
      orderIds: [],
      itemsSnapshot: [],
      subtotal: 0,
      discountAmount: 0,
      serviceFee: 0,
      taxAmount: 0,
      totalAmount: 0,
      totalItems: 0,
      paymentMethod: BillPaymentMethod.UNKNOWN
    });
  } catch (error: any) {
    if (error?.code !== 11000) {
      throw error;
    }
    bill = await deps.Bill.findOne({
      restaurantId: session.restaurantId,
      tableSessionId: session._id,
      status: { $in: ACTIVE_BILL_STATUSES }
    });
    if (!bill) {
      throw error;
    }
  }
  await setSessionBill(session, bill);
  return bill;
};

export const appendOrderToBill = async (
  order: any,
  session: any,
  deps: BillLifecycleDeps = defaultDeps
) => {
  const bill = await resolveActiveBillForSession(session, deps);
  if (!isActiveBill(bill.status)) {
    throw new BillLifecycleError(400, "Bill da dong hoac da thanh toan");
  }

  const hasOrder = bill.orderIds.some((orderId: any) => sameId(orderId, order._id));
  if (!hasOrder) {
    bill.orderIds.push(order._id);

    for (const item of order.items || []) {
      const unitPrice = Number(item.price) || 0;
      const quantity = Number(item.quantity) || 0;
      const notes = order.note || undefined;
      const existing = bill.itemsSnapshot.find((snapshot: any) => (
        snapshot.menuItemId === item.menuItemId &&
        snapshot.name === item.name &&
        Number(snapshot.unitPrice) === unitPrice &&
        (snapshot.notes || undefined) === notes
      ));

      if (existing) {
        existing.quantity += quantity;
        existing.totalPrice = existing.quantity * existing.unitPrice;
      } else {
        bill.itemsSnapshot.push({
          menuItemId: item.menuItemId,
          name: item.name,
          quantity,
          unitPrice,
          totalPrice: unitPrice * quantity,
          notes
        });
      }
    }
  }

  recomputeBillTotals(bill);

  order.billId = bill._id;
  order.billCode = bill.billCode;
  order.billStatus = bill.status;
  if (typeof order.save === "function") {
    await order.save();
  }

  session.billId = bill._id;
  session.orderCount = bill.orderIds.length;
  session.totalAmount = bill.totalAmount;
  if (typeof session.save === "function") {
    await session.save();
  }

  await bill.save();
  return bill;
};

export const payBill = async (
  input: {
    billId: string | Types.ObjectId;
    restaurantId?: string | Types.ObjectId;
    paymentMethod?: string;
    cashReceived?: number;
    paidBy?: string | Types.ObjectId;
  },
  deps: BillLifecycleDeps = defaultDeps
) => {
  const billObjectId = toObjectId(input.billId, "billId");
  const restaurantObjectId = input.restaurantId
    ? toObjectId(input.restaurantId, "restaurantId")
    : undefined;
  const paymentMethod = normalizeBillPaymentMethod(input.paymentMethod);
  validateRestaurantPaymentMethod(paymentMethod);

  const billFilter: Record<string, unknown> = { _id: billObjectId };
  if (restaurantObjectId) billFilter.restaurantId = restaurantObjectId;

  const bill = await deps.Bill.findOne(billFilter);
  if (!bill) {
    throw new BillLifecycleError(404, "Khong tim thay bill");
  }

  const session = await deps.TableSession.findOne({
    _id: bill.tableSessionId,
    restaurantId: bill.restaurantId
  });
  if (!session) {
    throw new BillLifecycleError(404, "Khong tim thay phien ban cua bill");
  }

  if (bill.status === BillStatus.PAID) {
    return { bill, session, table: null, alreadyPaid: true };
  }

  if (!isActiveSession(session.status)) {
    throw new BillLifecycleError(400, "Phien ban khong con mo");
  }

  const now = new Date();
  let cashReceived: number | undefined;
  let changeAmount: number | undefined;

  if (paymentMethod === BillPaymentMethod.CASH) {
    cashReceived = normalizeCashReceived(input.cashReceived);
    if (cashReceived < bill.totalAmount) {
      throw new BillLifecycleError(400, "Tien khach dua phai lon hon hoac bang tong bill");
    }
    changeAmount = cashReceived - bill.totalAmount;
  }

  const orderPaymentMethod = mapBillPaymentToOrderPayment(paymentMethod);

  await deps.Order.updateMany(
    {
      billId: bill._id,
      status: { $ne: OrderStatus.CANCELLED }
    },
    {
      $set: {
        status: OrderStatus.COMPLETED,
        paymentMethod: orderPaymentMethod,
        billStatus: BillStatus.PAID
      }
    }
  );

  bill.status = BillStatus.PAID;
  bill.paymentMethod = paymentMethod;
  if (paymentMethod === BillPaymentMethod.CASH) {
    bill.cashReceived = cashReceived;
    bill.changeAmount = changeAmount;
  } else {
    bill.cashReceived = undefined;
    bill.changeAmount = undefined;
  }
  if (input.paidBy) {
    bill.paidBy = toObjectId(input.paidBy, "paidBy");
  }
  bill.paidAt = now;
  await bill.save();

  session.status = TableSessionStatus.PAID;
  session.paidAt = now;
  session.closedAt = now;
  session.billId = bill._id;
  session.totalAmount = bill.totalAmount;
  session.orderCount = bill.orderIds.length;
  if (input.paidBy) {
    session.closedBy = toObjectId(input.paidBy, "paidBy");
  }
  await session.save();

  const table = await deps.Table.findByIdAndUpdate(
    session.tableId,
    {
      status: TableStatus.AVAILABLE,
      activeSessionId: null,
      currentSessionCode: null,
      lastSessionClosedAt: now
    },
    { new: true }
  );

  return { bill, session, table, alreadyPaid: false };
};

export const getCurrentBillForCustomer = async (
  input: {
    restaurantId: string | Types.ObjectId;
    tableNumber: string;
    sessionId?: string | Types.ObjectId;
  },
  deps: BillLifecycleDeps = defaultDeps
) => {
  const restaurantObjectId = toObjectId(input.restaurantId, "restaurantId");
  const tableNumber = input.tableNumber.trim();

  let session: any | null = null;
  if (input.sessionId) {
    const sessionObjectId = toObjectId(input.sessionId, "sessionId");
    session = await deps.TableSession.findById(sessionObjectId);
  } else {
    session = await deps.TableSession.findOne({
      restaurantId: restaurantObjectId,
      tableNumber,
      status: { $in: ACTIVE_SESSION_STATUSES }
    });
  }

  if (
    !session ||
    !sameId(session.restaurantId, restaurantObjectId) ||
    session.tableNumber !== tableNumber ||
    !isActiveSession(session.status)
  ) {
    return { session: null, bill: null, orders: [] };
  }

  const bill = await resolveActiveBillForSession(session, deps);
  const orders = await fetchOrders(deps, { billId: bill._id });
  return { session, bill, orders };
};

export const getActiveBillsForRestaurant = async (
  input: {
    restaurantId: string | Types.ObjectId;
  },
  deps: BillLifecycleDeps = defaultDeps
) => {
  const restaurantObjectId = toObjectId(input.restaurantId, "restaurantId");
  const bills = await fetchBills(deps, {
    restaurantId: restaurantObjectId,
    status: { $in: ACTIVE_BILL_STATUSES }
  });

  const results = [];

  for (const bill of bills) {
    const session = await fetchSessionById(deps, bill.tableSessionId);

    if (session && !isActiveSession(session.status)) {
      continue;
    }

    results.push(await buildBillGroup(deps, bill));
  }

  return results;
};

export const listBillsForRestaurant = async (
  input: {
    restaurantId: string | Types.ObjectId;
    status?: string;
    tableNumber?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  },
  deps: BillLifecycleDeps = defaultDeps
) => {
  const restaurantObjectId = toObjectId(input.restaurantId, "restaurantId");
  const page = Math.max(1, Number(input.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 20));

  const filter: Record<string, unknown> = {
    restaurantId: restaurantObjectId
  };

  if (input.tableNumber?.trim()) {
    filter.tableNumber = input.tableNumber.trim();
  }

  if (input.dateFrom || input.dateTo) {
    const createdAt: Record<string, Date> = {};
    if (input.dateFrom) createdAt.$gte = new Date(input.dateFrom);
    if (input.dateTo) {
      const end = new Date(input.dateTo);
      end.setHours(23, 59, 59, 999);
      createdAt.$lte = end;
    }
    filter.createdAt = createdAt;
  }

  const bills = await fetchBills(deps, filter);
  const groups = [];

  for (const bill of bills) {
    const group = await buildBillGroup(deps, bill);
    if (!billGroupMatchesStatus(group, input.status)) {
      continue;
    }
    if (!billGroupMatchesSearch(group, input.search)) {
      continue;
    }
    groups.push(group);
  }

  const total = groups.length;
  const start = (page - 1) * limit;

  return {
    bills: groups.slice(start, start + limit),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
};
