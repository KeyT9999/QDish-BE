import type { AuthPayload } from "../middleware/auth.js";
import { Restaurant, RestaurantStatus } from "../models/Restaurant.js";
import { withOwnerRestaurantQuotaLease } from "./ownerRestaurantQuotaLeaseService.js";

export class ArchivedRestaurantSocketError extends Error {
  readonly code = "RESTAURANT_ARCHIVED";

  constructor() {
    super("Chi nhánh đã lưu trữ; tài khoản không thể tiếp tục truy cập.");
  }
}

export class UnauthorizedRestaurantSocketError extends Error {
  readonly code = "FORBIDDEN";

  constructor() {
    super("Tài khoản không có quyền truy cập chi nhánh này.");
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

export function createRestaurantBranchSocketAccessService(deps: SocketAccessDependencies = defaultDependencies) {
  return async function withAuthorizedRestaurantSocketAccess(
    auth: AuthPayload,
    restaurantId: string,
    admit: () => Promise<void> | void
  ): Promise<void> {
    if (!/^[a-f\d]{24}$/i.test(restaurantId)) {
      throw new UnauthorizedRestaurantSocketError();
    }

    const findRestaurant = async () => {
      const query = deps.Restaurant.findById(restaurantId);
      return typeof (query as any)?.select === "function"
        ? (query as any).select("ownerId archivedAt status active")
        : query;
    };

    const assertCanAccess = (restaurant: any) => {
      if (!restaurant || restaurant.archivedAt) throw new ArchivedRestaurantSocketError();
      if (
        (restaurant.status && restaurant.status !== RestaurantStatus.ACTIVE) ||
        restaurant.active === false
      ) {
        throw new ArchivedRestaurantSocketError();
      }

      const ownerId = restaurant.ownerId?.toString();
      const isOwner = auth.role === "RESTAURANT_OWNER" && ownerId === auth.sub;
      const isAssignedStaff =
        (auth.role === "RESTAURANT_ADMIN" || auth.role === "STAFF") &&
        auth.restaurantId?.toString() === restaurantId;

      if (!isOwner && !isAssignedStaff) throw new UnauthorizedRestaurantSocketError();
      return ownerId;
    };

    const initialRestaurant: any = await findRestaurant();
    const ownerId = assertCanAccess(initialRestaurant);
    if (!ownerId) {
      await admit();
      return;
    }

    await deps.withQuotaLease(ownerId, async lease => {
      await lease.assertHeld();
      const currentRestaurant: any = await findRestaurant();
      const currentOwnerId = assertCanAccess(currentRestaurant);
      if (currentOwnerId !== ownerId) throw new UnauthorizedRestaurantSocketError();

      // Join the authorized room while holding the same owner lease as archive.
      await admit();
    });
  };
}

export const withAuthorizedRestaurantSocketAccess = createRestaurantBranchSocketAccessService();
