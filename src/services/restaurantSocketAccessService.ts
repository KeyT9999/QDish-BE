import type { AuthPayload } from "../middleware/auth.js";
import { Restaurant } from "../models/Restaurant.js";
import { withOwnerRestaurantQuotaLease } from "./ownerRestaurantQuotaLeaseService.js";

export class ArchivedRestaurantSocketError extends Error {
  readonly code = "RESTAURANT_ARCHIVED";

  constructor() {
    super("Chi nhánh đã lưu trữ; tài khoản không thể tiếp tục truy cập.");
  }
}

type SocketAccessDependencies = {
  Restaurant: Pick<typeof Restaurant, "findById">;
  withQuotaLease: typeof withOwnerRestaurantQuotaLease;
};

const defaultDependencies: SocketAccessDependencies = {
  Restaurant,
  withQuotaLease: withOwnerRestaurantQuotaLease
};

export function createRestaurantSocketAccessService(deps: SocketAccessDependencies = defaultDependencies) {
  return async function withRestaurantSocketAccess(
    auth: AuthPayload,
    admit: () => Promise<void> | void
  ): Promise<void> {
    if (!auth.restaurantId || !["RESTAURANT_ADMIN", "STAFF"].includes(auth.role)) {
      await admit();
      return;
    }

    const findRestaurant = async () => {
      const query = deps.Restaurant.findById(auth.restaurantId);
      return typeof (query as any)?.select === "function"
        ? (query as any).select("ownerId archivedAt")
        : query;
    };
    const initialRestaurant: any = await findRestaurant();
    if (!initialRestaurant || initialRestaurant.archivedAt) throw new ArchivedRestaurantSocketError();
    if (!initialRestaurant.ownerId) {
      await admit();
      return;
    }

    await deps.withQuotaLease(initialRestaurant.ownerId.toString(), async lease => {
      await lease.assertHeld();
      const currentRestaurant: any = await findRestaurant();
      if (!currentRestaurant || currentRestaurant.archivedAt) throw new ArchivedRestaurantSocketError();
      // Join the room before releasing the shared lease. If archive wins next,
      // its disconnect pass is guaranteed to see this socket in the room.
      await admit();
    });
  };
}

export const withRestaurantSocketAccess = createRestaurantSocketAccessService();
