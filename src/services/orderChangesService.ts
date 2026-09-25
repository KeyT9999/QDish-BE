import { Types } from "mongoose";
import type { AuthPayload } from "../middleware/auth.js";
import { Order } from "../models/Order.js";
import { RestaurantStatus } from "../models/Restaurant.js";

type OrderChangesDependencies = {
  Order: Pick<typeof Order, "find">;
};

type OrderChangesCursor = {
  updatedAt: Date;
  id: Types.ObjectId;
};

export class OrderChangesAccessError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code = "FORBIDDEN", statusCode = 403) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class InvalidOrderChangesQueryError extends Error {
  readonly code = "INVALID_ORDER_CHANGES_QUERY";
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
  }
}

export function assertRestaurantOrderChangesAccess(
  auth: AuthPayload,
  restaurantId: string,
  restaurant: { ownerId?: unknown; archivedAt?: Date | null; status?: string; active?: boolean } | null
) {
  if (!restaurant || restaurant.archivedAt) {
    throw new OrderChangesAccessError("Chi nhánh không hoạt động hoặc đã lưu trữ.", "RESTAURANT_ARCHIVED");
  }
  if (
    (restaurant.status && restaurant.status !== RestaurantStatus.ACTIVE) ||
    restaurant.active === false
  ) {
    throw new OrderChangesAccessError("Chi nhánh không hoạt động hoặc đã lưu trữ.", "RESTAURANT_ARCHIVED");
  }

  const ownerId = (restaurant.ownerId as any)?.toString();
  const isOwner = auth.role === "RESTAURANT_OWNER" && ownerId === auth.sub;
  const isAssignedStaff =
    (auth.role === "RESTAURANT_ADMIN" || auth.role === "STAFF") &&
    auth.restaurantId?.toString() === restaurantId;

  if (!isOwner && !isAssignedStaff) {
    throw new OrderChangesAccessError("Bạn không có quyền xem đơn của chi nhánh này.");
  }
}

const encodeCursor = (cursor: OrderChangesCursor) => Buffer.from(JSON.stringify({
  updatedAt: cursor.updatedAt.toISOString(),
  id: cursor.id.toString()
})).toString("base64url");

const decodeCursor = (value: string): OrderChangesCursor => {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const updatedAt = new Date(parsed.updatedAt);
    if (!Number.isFinite(updatedAt.getTime()) || !/^[a-f\d]{24}$/i.test(parsed.id)) {
      throw new Error("invalid cursor fields");
    }
    return { updatedAt, id: new Types.ObjectId(parsed.id) };
  } catch {
    throw new InvalidOrderChangesQueryError("Con trỏ đồng bộ đơn hàng không hợp lệ.");
  }
};

export function createOrderChangesService(deps: OrderChangesDependencies = { Order }) {
  return async function getOrderChanges(input: {
    restaurantId: string;
    since: Date;
    snapshotAt?: Date;
    cursor?: string;
    limit?: number;
  }) {
    if (!/^[a-f\d]{24}$/i.test(input.restaurantId)) {
      throw new InvalidOrderChangesQueryError("restaurantId không hợp lệ.");
    }
    if (!Number.isFinite(input.since.getTime())) {
      throw new InvalidOrderChangesQueryError("Mốc đồng bộ đơn hàng không hợp lệ.");
    }

    const snapshotAt = input.snapshotAt || new Date();
    if (!Number.isFinite(snapshotAt.getTime()) || snapshotAt < input.since) {
      throw new InvalidOrderChangesQueryError("Mốc snapshot đơn hàng không hợp lệ.");
    }

    const limit = Math.min(Math.max(Math.trunc(input.limit || 100), 1), 200);
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    if (cursor && (cursor.updatedAt < input.since || cursor.updatedAt > snapshotAt)) {
      throw new InvalidOrderChangesQueryError("Con trỏ đồng bộ nằm ngoài khoảng thời gian yêu cầu.");
    }

    const filter: Record<string, unknown> = {
      restaurantId: new Types.ObjectId(input.restaurantId),
      updatedAt: { $gte: input.since, $lte: snapshotAt }
    };
    if (cursor) {
      filter.$or = [
        { updatedAt: { $gt: cursor.updatedAt } },
        { updatedAt: cursor.updatedAt, _id: { $gt: cursor.id } }
      ];
    }

    const rows = await deps.Order.find(filter as any)
      .sort({ updatedAt: 1, _id: 1 })
      .limit(limit + 1)
      .lean();
    const hasMore = rows.length > limit;
    const orders = rows.slice(0, limit);
    const lastOrder = orders[orders.length - 1] as any;

    return {
      orders,
      snapshotAt: snapshotAt.toISOString(),
      hasMore,
      nextCursor: hasMore && lastOrder?.updatedAt && lastOrder?._id
        ? encodeCursor({ updatedAt: new Date(lastOrder.updatedAt), id: new Types.ObjectId(lastOrder._id) })
        : null
    };
  };
}

export const getOrderChanges = createOrderChangesService();
