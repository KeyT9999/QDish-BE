import mongoose, { Types } from "mongoose";
import { performance } from "node:perf_hooks";
import { Restaurant, RestaurantStatus } from "../models/Restaurant.js";
import { withOwnerRestaurantQuotaLease } from "./ownerRestaurantQuotaLeaseService.js";

export class RestaurantNotAcceptingOrdersError extends Error {
  constructor() {
    super("Restaurant is not accepting orders");
  }
}

export type RestaurantOrderWriteTiming = {
  leaseWaitMs: number;
  restaurantGateMs: number;
  writeMs: number;
};

type OrderWriteDependencies = {
  Restaurant: Pick<typeof Restaurant, "findById">;
  withQuotaLease: typeof withOwnerRestaurantQuotaLease;
};

const defaultDependencies: OrderWriteDependencies = {
  Restaurant,
  withQuotaLease: withOwnerRestaurantQuotaLease
};

export function createRestaurantOrderWriteService(deps: OrderWriteDependencies = defaultDependencies) {
  return async function withActiveRestaurantOrderWrite<T>(
    restaurantId: string | Types.ObjectId,
    ownerId: string | Types.ObjectId | undefined,
    write: () => Promise<T>,
    onTiming?: (timing: RestaurantOrderWriteTiming) => void
  ): Promise<T> {
    const startedAt = performance.now();
    const verifyAndWrite = async (assertHeld?: () => Promise<void>) => {
      await assertHeld?.();
      const leaseWaitMs = assertHeld ? performance.now() - startedAt : 0;
      const gateStartedAt = performance.now();
      const restaurant = await deps.Restaurant.findById(restaurantId).select("archivedAt status active");
      const restaurantGateMs = performance.now() - gateStartedAt;
      if (!restaurant || restaurant.archivedAt || restaurant.status !== RestaurantStatus.ACTIVE || restaurant.active === false) {
        onTiming?.({ leaseWaitMs, restaurantGateMs, writeMs: 0 });
        throw new RestaurantNotAcceptingOrdersError();
      }
      const writeStartedAt = performance.now();
      try {
        return await write();
      } finally {
        onTiming?.({
          leaseWaitMs,
          restaurantGateMs,
          writeMs: performance.now() - writeStartedAt
        });
      }
    };

    if (!ownerId) return verifyAndWrite();
    return deps.withQuotaLease(ownerId.toString(), lease => verifyAndWrite(() => lease.assertHeld()));
  };
}

export const withActiveRestaurantOrderWrite = createRestaurantOrderWriteService();
