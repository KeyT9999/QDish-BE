import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  assertRestaurantOrderChangesAccess,
  createOrderChangesService
} from "../services/orderChangesService.js";

async function run() {
  const ownerId = new mongoose.Types.ObjectId();
  const foreignOwnerId = new mongoose.Types.ObjectId();
  const restaurantId = new mongoose.Types.ObjectId();
  const orders = [
    { _id: new mongoose.Types.ObjectId(), restaurantId, updatedAt: new Date("2026-09-25T01:00:00.000Z"), status: "PENDING" },
    { _id: new mongoose.Types.ObjectId(), restaurantId, updatedAt: new Date("2026-09-25T01:00:00.000Z"), status: "CONFIRMED" },
    { _id: new mongoose.Types.ObjectId(), restaurantId, updatedAt: new Date("2026-09-25T01:00:02.000Z"), status: "SERVED" }
  ];

  assert.doesNotThrow(() => assertRestaurantOrderChangesAccess(
    { sub: ownerId.toString(), role: "RESTAURANT_OWNER" },
    restaurantId.toString(),
    { ownerId, status: "ACTIVE", active: true }
  ));
  assert.throws(() => assertRestaurantOrderChangesAccess(
    { sub: foreignOwnerId.toString(), role: "RESTAURANT_OWNER" },
    restaurantId.toString(),
    { ownerId, status: "ACTIVE", active: true }
  ), (error: any) => error.code === "FORBIDDEN");
  assert.throws(() => assertRestaurantOrderChangesAccess(
    { sub: "staff-1", role: "STAFF", restaurantId: foreignOwnerId.toString() },
    restaurantId.toString(),
    { ownerId, status: "ACTIVE", active: true }
  ), (error: any) => error.code === "FORBIDDEN");

  const getOrderChanges = createOrderChangesService({
      Order: {
      find: (filter: any) => {
        let requestedLimit = 0;
        return {
          sort() { return this; },
          limit(value: number) { requestedLimit = value; return this; },
          lean: async () => orders
            .filter((order) => {
              if (!order.restaurantId.equals(filter.restaurantId)) return false;
              if (order.updatedAt < filter.updatedAt.$gte || order.updatedAt > filter.updatedAt.$lte) return false;
              if (filter.$or) {
                return filter.$or.some((clause: any) => {
                  if (clause.updatedAt?.$gt) return order.updatedAt > clause.updatedAt.$gt;
                  return order.updatedAt.getTime() === clause.updatedAt.getTime() &&
                    order._id.toString().localeCompare(clause._id.$gt.toString()) > 0;
                });
              }
              return true;
            })
            .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a._id.toString().localeCompare(b._id.toString()))
            .slice(0, requestedLimit)
        };
      }
    } as any
  } as any);

  const firstPage = await getOrderChanges({
    restaurantId: restaurantId.toString(),
    since: new Date("2026-09-25T00:59:00.000Z"),
    snapshotAt: new Date("2026-09-25T01:00:01.500Z"),
    limit: 1
  });
  assert.equal(firstPage.orders.length, 1);
  assert.equal(firstPage.hasMore, true);
  assert.ok(firstPage.nextCursor);

  const secondPage = await getOrderChanges({
    restaurantId: restaurantId.toString(),
    since: new Date("2026-09-25T00:59:00.000Z"),
    snapshotAt: new Date("2026-09-25T01:00:01.500Z"),
    cursor: firstPage.nextCursor || undefined,
    limit: 1
  });
  assert.equal(secondPage.orders.length, 1);
  assert.equal(secondPage.orders[0]._id.toString(), orders[1]._id.toString());
  assert.equal(secondPage.hasMore, false);

  await assert.rejects(
    getOrderChanges({
      restaurantId: restaurantId.toString(),
      since: new Date("2026-09-25T00:59:00.000Z"),
      cursor: "invalid-cursor"
    }),
    (error: any) => error.code === "INVALID_ORDER_CHANGES_QUERY"
  );
}

run().then(() => console.log("order changes service tests passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
