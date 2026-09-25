import mongoose, { Types } from "mongoose";
import { Restaurant, RestaurantStatus } from "../models/Restaurant.js";
import { withOwnerRestaurantQuotaLease } from "./ownerRestaurantQuotaLeaseService.js";

export class RestaurantNotAcceptingOrdersError extends Error {
  constructor() {
    super("Restaurant is not accepting orders");
  }
}

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
    write: () => Promise<T>
  ): Promise<T> {
    const verifyAndWrite = async (assertHeld?: () => Promise<void>) => {
      await assertHeld?.();
      const restaurant = await deps.Restaurant.findById(restaurantId).select("archivedAt status active");
      if (!restaurant || restaurant.archivedAt || restaurant.status !== RestaurantStatus.ACTIVE || restaurant.active === false) {
        throw new RestaurantNotAcceptingOrdersError();
      }
      return write();
    };

    if (!ownerId) return verifyAndWrite();
    return deps.withQuotaLease(ownerId.toString(), lease => verifyAndWrite(() => lease.assertHeld()));
  };
}

export const withActiveRestaurantOrderWrite = createRestaurantOrderWriteService();
