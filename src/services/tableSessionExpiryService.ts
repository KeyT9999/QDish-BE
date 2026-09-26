import { Bill, BillStatus } from "../models/Bill.js";
import { Order } from "../models/Order.js";
import { Table, TableStatus } from "../models/Table.js";
import {
  SessionCreatedBy,
  TableSession,
  TableSessionStatus
} from "../models/TableSession.js";
import { Restaurant } from "../models/Restaurant.js";
import { withActiveRestaurantOrderWrite } from "./restaurantOrderWriteService.js";

export const TABLE_SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const AUTO_EXPIRE_NO_ORDER_REASON = "AUTO_EXPIRED_NO_ORDER";

export type ExpiredTableSessionResult = {
  session: any;
  table: any;
  bill: any;
};

type TableSessionExpiryDeps = {
  Restaurant?: any;
  TableSession: any;
  Table: any;
  Order: any;
  Bill: any;
  withOrderWrite?: typeof withActiveRestaurantOrderWrite;
  now?: () => Date;
};

const defaultDeps: TableSessionExpiryDeps = {
  Restaurant,
  TableSession,
  Table,
  Order,
  Bill,
  withOrderWrite: withActiveRestaurantOrderWrite,
  now: () => new Date()
};

const activeBillStatuses = [BillStatus.UNPAID, BillStatus.PAYMENT_REQUESTED];

const getNow = (deps: TableSessionExpiryDeps, inputNow?: Date) => inputNow || deps.now?.() || new Date();

const toDate = (value: unknown) => {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
};

export const isIdleScanOnlySession = (
  session: any,
  now: Date,
  timeoutMs = TABLE_SESSION_IDLE_TIMEOUT_MS
) => {
  const openedAt = toDate(session?.openedAt);
  if (!openedAt) return false;

  return session?.status === TableSessionStatus.OPEN
    && session?.createdBy === SessionCreatedBy.CUSTOMER_SCAN
    && Number(session?.orderCount || 0) === 0
    && openedAt.getTime() <= now.getTime() - timeoutMs;
};

const hasOrderForSession = async (deps: TableSessionExpiryDeps, sessionId: unknown) => {
  if (typeof deps.Order.exists === "function") {
    return Boolean(await deps.Order.exists({ tableSessionId: sessionId }));
  }

  if (typeof deps.Order.findOne === "function") {
    return Boolean(await deps.Order.findOne({ tableSessionId: sessionId }));
  }

  return false;
};

const expireIdleTableSessionWithinWrite = async (
  input: { sessionId: unknown; now?: Date },
  deps: TableSessionExpiryDeps
): Promise<ExpiredTableSessionResult | null> => {
  const now = getNow(deps, input.now);
  const cutoff = new Date(now.getTime() - TABLE_SESSION_IDLE_TIMEOUT_MS);
  const session = await deps.TableSession.findOne({
    _id: input.sessionId,
    status: TableSessionStatus.OPEN,
    createdBy: SessionCreatedBy.CUSTOMER_SCAN,
    openedAt: { $lte: cutoff },
    orderCount: 0
  });

  if (!session || await hasOrderForSession(deps, session._id)) {
    return null;
  }

  // The conditional update is the claim. Only one worker can transition this
  // session, so duplicate cleanup runs become harmless no-ops.
  const expiredSession = await deps.TableSession.findOneAndUpdate(
    {
      _id: session._id,
      status: TableSessionStatus.OPEN,
      createdBy: SessionCreatedBy.CUSTOMER_SCAN,
      openedAt: { $lte: cutoff },
      orderCount: 0
    },
    {
      $set: {
        status: TableSessionStatus.CANCELLED,
        closedAt: now,
        metadata: {
          ...((session.metadata as Record<string, unknown>) || {}),
          closeReason: AUTO_EXPIRE_NO_ORDER_REASON,
          autoExpiredAt: now
        }
      }
    },
    { new: true }
  );

  if (!expiredSession) return null;

  let bill: any = null;
  if (typeof deps.Bill.findOneAndUpdate === "function") {
    bill = await deps.Bill.findOneAndUpdate(
      {
        tableSessionId: expiredSession._id,
        status: { $in: activeBillStatuses },
        orderIds: { $size: 0 }
      },
      { $set: { status: BillStatus.CANCELLED } },
      { new: true }
    );
  }

  const table = await deps.Table.findOneAndUpdate(
    {
      _id: expiredSession.tableId,
      activeSessionId: expiredSession._id
    },
    {
      $set: {
        status: TableStatus.AVAILABLE,
        activeSessionId: null,
        currentSessionCode: null,
        lastSessionClosedAt: now
      }
    },
    { new: true }
  );

  return { session: expiredSession, table, bill };
};

export const expireIdleTableSession = async (
  input: { sessionId: unknown; now?: Date },
  providedDeps: Partial<TableSessionExpiryDeps> = {}
): Promise<ExpiredTableSessionResult | null> => {
  const deps = { ...defaultDeps, ...providedDeps };
  const now = getNow(deps, input.now);
  const session = await deps.TableSession.findOne({ _id: input.sessionId });

  if (!session || !isIdleScanOnlySession(session, now)) return null;

  const expire = () => expireIdleTableSessionWithinWrite(input, deps);
  if (deps.withOrderWrite && deps.Restaurant?.findById) {
    const restaurant = await deps.Restaurant.findById(session.restaurantId);
    return deps.withOrderWrite(session.restaurantId, restaurant?.ownerId, expire);
  }

  return expire();
};

export const expireIdleTableSessions = async (
  providedDeps: Partial<TableSessionExpiryDeps> = {},
  onExpired?: (result: ExpiredTableSessionResult) => Promise<void> | void
) => {
  const deps = { ...defaultDeps, ...providedDeps };
  const now = getNow(deps);
  const cutoff = new Date(now.getTime() - TABLE_SESSION_IDLE_TIMEOUT_MS);
  const query = deps.TableSession.find({
    status: TableSessionStatus.OPEN,
    createdBy: SessionCreatedBy.CUSTOMER_SCAN,
    openedAt: { $lte: cutoff },
    orderCount: 0
  });
  const sortedQuery = typeof query?.sort === "function" ? query.sort({ openedAt: 1 }) : query;
  const result = typeof sortedQuery?.lean === "function" ? await sortedQuery.lean() : await sortedQuery;
  const candidates = Array.isArray(result) ? result : [];
  let expiredCount = 0;

  for (const candidate of candidates) {
    const expired = await expireIdleTableSession({ sessionId: candidate._id, now }, deps);
    if (!expired) continue;
    expiredCount += 1;
    await onExpired?.(expired);
  }

  return { scannedCount: candidates.length, expiredCount };
};

export const expireIdleTableSessionWithinOrderWrite = (
  input: { sessionId: unknown; now?: Date },
  providedDeps: Partial<TableSessionExpiryDeps> = {}
) => expireIdleTableSessionWithinWrite(input, { ...defaultDeps, ...providedDeps });
