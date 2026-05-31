import mongoose, { Types } from "mongoose";

import { Order, OrderStatus, PaymentMethod } from "../models/Order.js";
import { Table, TableStatus } from "../models/Table.js";
import { SessionCreatedBy, TableSession, TableSessionStatus, generateSessionCode } from "../models/TableSession.js";

export const ACTIVE_TABLE_SESSION_STATUSES = [
  TableSessionStatus.OPEN,
  TableSessionStatus.PAYMENT_REQUESTED
];

export class TableSessionLifecycleError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

type TableSessionLifecycleDeps = {
  Table: any;
  TableSession: any;
  Order: any;
};

const defaultDeps: TableSessionLifecycleDeps = {
  Table,
  TableSession,
  Order
};

const toObjectId = (value: string | Types.ObjectId, fieldName: string) => {
  if (value instanceof Types.ObjectId) {
    return value;
  }

  if (!mongoose.isValidObjectId(value)) {
    throw new TableSessionLifecycleError(400, `${fieldName} khong hop le`);
  }

  return new Types.ObjectId(value);
};

const sameId = (left: unknown, right: unknown) => {
  if (!left || !right) return false;
  return left.toString() === right.toString();
};

const isActiveSessionStatus = (status: TableSessionStatus | string | undefined) => (
  status === TableSessionStatus.OPEN || status === TableSessionStatus.PAYMENT_REQUESTED
);

const getTableStatusForSession = (sessionStatus: TableSessionStatus | string) => (
  sessionStatus === TableSessionStatus.PAYMENT_REQUESTED
    ? TableStatus.PAYMENT_PENDING
    : TableStatus.OCCUPIED
);

const normalizePaymentMethod = (paymentMethod?: string) => {
  if (!paymentMethod) return undefined;
  if (paymentMethod === PaymentMethod.CASH || paymentMethod === PaymentMethod.BANK_TRANSFER) {
    return paymentMethod;
  }
  throw new TableSessionLifecycleError(400, "Hinh thuc thanh toan khong hop le");
};

const fetchOrders = async (deps: TableSessionLifecycleDeps, filter: Record<string, unknown>) => {
  const queryOrDocs = deps.Order.find(filter);
  if (typeof queryOrDocs?.sort === "function") {
    const sorted = queryOrDocs.sort({ createdAt: -1 });
    return typeof sorted?.lean === "function" ? sorted.lean() : sorted;
  }
  return queryOrDocs;
};

const refreshSessionTotals = async (deps: TableSessionLifecycleDeps, session: any) => {
  const orders = await fetchOrders(deps, {
    tableSessionId: session._id,
    status: { $ne: OrderStatus.CANCELLED }
  });
  const orderList = Array.isArray(orders) ? orders : [];
  session.orderCount = orderList.length;
  session.totalAmount = orderList.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0);
};

const updateTableForActiveSession = async (
  deps: TableSessionLifecycleDeps,
  tableId: unknown,
  session: any
) => {
  const tableStatus = getTableStatusForSession(session.status);
  return deps.Table.findByIdAndUpdate(
    tableId,
    {
      status: tableStatus,
      activeSessionId: session._id,
      currentSessionCode: session.sessionCode
    },
    { new: true }
  );
};

const releaseTableForSession = async (
  deps: TableSessionLifecycleDeps,
  tableId: unknown,
  sessionId: unknown,
  now: Date
) => {
  const update = {
    status: TableStatus.AVAILABLE,
    activeSessionId: null,
    currentSessionCode: null,
    lastSessionClosedAt: now
  };

  if (typeof deps.Table.findOneAndUpdate === "function") {
    return deps.Table.findOneAndUpdate(
      {
        _id: tableId,
        $or: [
          { activeSessionId: sessionId },
          { activeSessionId: null },
          { activeSessionId: { $exists: false } }
        ]
      },
      update,
      { new: true }
    );
  }

  return deps.Table.findByIdAndUpdate(tableId, update, { new: true });
};

const findActiveSessionByTable = async (
  deps: TableSessionLifecycleDeps,
  restaurantObjectId: Types.ObjectId,
  tableNumber: string
) => {
  return deps.TableSession.findOne({
    restaurantId: restaurantObjectId,
    tableNumber,
    status: { $in: ACTIVE_TABLE_SESSION_STATUSES }
  });
};

export const resolveTableSession = async (
  input: {
    restaurantId: string | Types.ObjectId;
    tableNumber: string;
    createdBy?: SessionCreatedBy;
  },
  deps: TableSessionLifecycleDeps = defaultDeps
) => {
  const restaurantObjectId = toObjectId(input.restaurantId, "restaurantId");
  const tableNumber = input.tableNumber.trim();

  const table = await deps.Table.findOne({
    restaurantId: restaurantObjectId,
    code: tableNumber,
    isActive: true
  });

  if (!table) {
    throw new TableSessionLifecycleError(404, "Ban khong ton tai trong nha hang");
  }

  if (table.activeSessionId) {
    const activeSession = await deps.TableSession.findById(table.activeSessionId);
    if (
      activeSession &&
      sameId(activeSession.restaurantId, restaurantObjectId) &&
      activeSession.tableNumber === tableNumber &&
      isActiveSessionStatus(activeSession.status)
    ) {
      const updatedTable = await updateTableForActiveSession(deps, table._id, activeSession);
      return { session: activeSession, table: updatedTable || table, created: false };
    }

    await deps.Table.findByIdAndUpdate(
      table._id,
      {
        status: TableStatus.AVAILABLE,
        activeSessionId: null,
        currentSessionCode: null
      },
      { new: true }
    );
  }

  const existingSession = await findActiveSessionByTable(deps, restaurantObjectId, tableNumber);
  if (existingSession) {
    const updatedTable = await updateTableForActiveSession(deps, table._id, existingSession);
    return { session: existingSession, table: updatedTable || table, created: false };
  }

  const sessionCode = generateSessionCode(tableNumber);

  try {
    const session = await deps.TableSession.create({
      restaurantId: restaurantObjectId,
      tableId: table._id,
      tableNumber,
      sessionCode,
      status: TableSessionStatus.OPEN,
      openedAt: new Date(),
      totalAmount: 0,
      orderCount: 0,
      createdBy: input.createdBy || SessionCreatedBy.CUSTOMER_SCAN
    });
    const updatedTable = await updateTableForActiveSession(deps, table._id, session);
    return { session, table: updatedTable || table, created: true };
  } catch (error: any) {
    if (error?.code === 11000) {
      const session = await findActiveSessionByTable(deps, restaurantObjectId, tableNumber);
      if (session) {
        const updatedTable = await updateTableForActiveSession(deps, table._id, session);
        return { session, table: updatedTable || table, created: false };
      }
    }
    throw error;
  }
};

export const closeTableSession = async (
  input: {
    sessionId: string | Types.ObjectId;
    restaurantId?: string | Types.ObjectId;
    paymentMethod?: string;
    markPaid?: boolean;
    closedBy?: string | Types.ObjectId;
    note?: string;
  },
  deps: TableSessionLifecycleDeps = defaultDeps
) => {
  const sessionObjectId = toObjectId(input.sessionId, "sessionId");
  const restaurantObjectId = input.restaurantId
    ? toObjectId(input.restaurantId, "restaurantId")
    : undefined;
  const paymentMethod = normalizePaymentMethod(input.paymentMethod);

  const sessionFilter: Record<string, unknown> = { _id: sessionObjectId };
  if (restaurantObjectId) {
    sessionFilter.restaurantId = restaurantObjectId;
  }

  const session = await deps.TableSession.findOne(sessionFilter);
  if (!session) {
    throw new TableSessionLifecycleError(404, "Khong tim thay phien ban");
  }

  const now = new Date();
  if (!isActiveSessionStatus(session.status)) {
    const table = await releaseTableForSession(deps, session.tableId, session._id, now);
    return { session, table, alreadyClosed: true };
  }

  const closeAsPaid = Boolean(input.markPaid || paymentMethod);
  const nextStatus = closeAsPaid ? TableSessionStatus.PAID : TableSessionStatus.CLOSED;

  if (closeAsPaid) {
    const orderUpdate: Record<string, unknown> = { status: OrderStatus.COMPLETED };
    if (paymentMethod) {
      orderUpdate.paymentMethod = paymentMethod;
    }

    await deps.Order.updateMany(
      {
        tableSessionId: session._id,
        status: { $ne: OrderStatus.CANCELLED }
      },
      { $set: orderUpdate }
    );
  }

  await refreshSessionTotals(deps, session);

  session.status = nextStatus;
  session.closedAt = now;
  if (closeAsPaid) {
    session.paidAt = now;
  }
  if (input.closedBy) {
    session.closedBy = toObjectId(input.closedBy, "closedBy");
  }
  if (input.note) {
    session.metadata = { ...((session.metadata as Record<string, unknown>) || {}), closeNote: input.note };
  }
  await session.save();

  const table = await releaseTableForSession(deps, session.tableId, session._id, now);
  return { session, table, alreadyClosed: false };
};

export const getCustomerOrderHistory = async (
  input: {
    restaurantId: string | Types.ObjectId;
    tableNumber: string;
    sessionId?: string | Types.ObjectId;
  },
  deps: TableSessionLifecycleDeps = defaultDeps
) => {
  const restaurantObjectId = toObjectId(input.restaurantId, "restaurantId");
  const tableNumber = input.tableNumber.trim();

  let session: any | null = null;
  if (input.sessionId) {
    const sessionObjectId = toObjectId(input.sessionId, "sessionId");
    session = await deps.TableSession.findById(sessionObjectId);
    if (
      !session ||
      !sameId(session.restaurantId, restaurantObjectId) ||
      session.tableNumber !== tableNumber ||
      !isActiveSessionStatus(session.status)
    ) {
      return [];
    }
  } else {
    const resolved = await resolveTableSession({ restaurantId: restaurantObjectId, tableNumber }, deps);
    session = resolved.session;
  }

  return fetchOrders(deps, {
    restaurantId: restaurantObjectId,
    tableNumber,
    tableSessionId: session._id
  });
};
