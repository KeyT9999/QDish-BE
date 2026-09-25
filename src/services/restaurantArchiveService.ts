import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { Restaurant } from "../models/Restaurant.js";
import { TableSession, TableSessionStatus } from "../models/TableSession.js";
import { Bill, BillStatus } from "../models/Bill.js";
import { checkPlanLimit } from "./subscriptionService.js";
import { withOwnerRestaurantQuotaLease } from "./ownerRestaurantQuotaLeaseService.js";
import { disconnectRestaurantStaffSockets } from "../realtime/socket.js";

export class RestaurantArchiveError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    Object.assign(this, details);
  }
  toResponse() {
    return { message: this.message, ...this.details };
  }
}

type ArchiveDependencies = {
  Restaurant: Pick<typeof Restaurant, "findOne" | "findOneAndUpdate">;
  TableSession: Pick<typeof TableSession, "countDocuments">;
  Bill: Pick<typeof Bill, "countDocuments">;
  checkPlanLimit: typeof checkPlanLimit;
  withQuotaLease: typeof withOwnerRestaurantQuotaLease;
  disconnectStaffSockets: (restaurantId: string) => Promise<void>;
};

const defaultDependencies: ArchiveDependencies = {
  Restaurant,
  TableSession,
  Bill,
  checkPlanLimit,
  withQuotaLease: withOwnerRestaurantQuotaLease,
  disconnectStaffSockets: disconnectRestaurantStaffSockets
};

export function createRestaurantArchiveService(deps: ArchiveDependencies = defaultDependencies) {
  const archiveTransitionMs = 60_000;
  const ownedFilter = (ownerId: string, restaurantId: string) => {
    if (!mongoose.isValidObjectId(restaurantId)) {
      throw new RestaurantArchiveError(400, "Mã nhà hàng không hợp lệ");
    }
    if (!ownerId || !mongoose.isValidObjectId(ownerId)) {
      throw new RestaurantArchiveError(403, "Không xác định được chủ sở hữu");
    }
    return {
      _id: new mongoose.Types.ObjectId(restaurantId),
      ownerId: new mongoose.Types.ObjectId(ownerId)
    };
  };

  const findOwned = async (filter: ReturnType<typeof ownedFilter>) => {
    const restaurant = await deps.Restaurant.findOne(filter);
    if (!restaurant) {
      throw new RestaurantArchiveError(404, "Không tìm thấy chi nhánh hoặc bạn không có quyền truy cập");
    }
    return restaurant;
  };

  const recoverPendingArchive = async (filter: ReturnType<typeof ownedFilter>, restaurant: Awaited<ReturnType<typeof findOwned>>) => {
    if (!restaurant.archiveTransitionId) return false;
    if (!restaurant.archiveTransitionExpiresAt || restaurant.archiveTransitionExpiresAt.getTime() > Date.now()) {
      throw new RestaurantArchiveError(409, "Chi nhánh đang được lưu trữ", { code: "RESTAURANT_ARCHIVE_IN_PROGRESS" });
    }
    await deps.Restaurant.findOneAndUpdate(
      { ...filter, archivedAt: restaurant.archivedAt, archiveTransitionId: restaurant.archiveTransitionId },
      { $unset: { archivedAt: "", archivedByOwnerId: "", archiveTransitionId: "", archiveTransitionExpiresAt: "" } },
      { new: true }
    );
    return true;
  };

  const archive = async (ownerId: string, restaurantId: string): Promise<{ restaurantId: string; archivedAt: Date }> => {
      const filter = ownedFilter(ownerId, restaurantId);
      await findOwned(filter);
      return deps.withQuotaLease(ownerId, async lease => {
      const archiveWithinLease = async (): Promise<{ restaurantId: string; archivedAt: Date }> => {
      const restaurant = await findOwned(filter);
      if (await recoverPendingArchive(filter, restaurant)) return archiveWithinLease();
      if (restaurant.archivedAt) {
        return { restaurantId, archivedAt: restaurant.archivedAt };
      }

      await lease.assertHeld();
      const marker = new Date();
      const transitionId = randomUUID();
      const claimed = await deps.Restaurant.findOneAndUpdate(
        { ...filter, archivedAt: null },
        { $set: {
          archivedAt: marker,
          archivedByOwnerId: filter.ownerId,
          archiveTransitionId: transitionId,
          archiveTransitionExpiresAt: new Date(marker.getTime() + archiveTransitionMs)
        } },
        { new: true }
      );
      if (!claimed) {
        const current = await findOwned(filter);
        if (await recoverPendingArchive(filter, current)) return archiveWithinLease();
        if (current.archivedAt) return { restaurantId, archivedAt: current.archivedAt };
        throw new RestaurantArchiveError(409, "Không thể lưu trữ chi nhánh do trạng thái đã thay đổi");
      }

      const exactMarker = { ...filter, archivedAt: marker, archiveTransitionId: transitionId };
      let finalized: any;
      try {
        const [activeSessions, unpaidBills] = await Promise.all([
          deps.TableSession.countDocuments({
            restaurantId: filter._id,
            status: { $in: [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_REQUESTED] }
          }),
          deps.Bill.countDocuments({
            restaurantId: filter._id,
            status: { $in: [BillStatus.UNPAID, BillStatus.PAYMENT_REQUESTED] }
          })
        ]);
        if (activeSessions || unpaidBills) {
          throw new RestaurantArchiveError(409, "Đóng các phiên bàn và thanh toán hết hóa đơn trước khi lưu trữ chi nhánh.", {
            code: "RESTAURANT_HAS_OPEN_ACTIVITY", activeSessions, unpaidBills
          });
        }
        await lease.assertHeld();
        finalized = await deps.Restaurant.findOneAndUpdate(
          exactMarker,
          { $unset: { archiveTransitionId: "", archiveTransitionExpiresAt: "" } },
          { new: true }
        );
        if (!finalized?.archivedAt) throw new RestaurantArchiveError(409, "Không thể hoàn tất lưu trữ chi nhánh");
      } catch (error) {
        await deps.Restaurant.findOneAndUpdate(
          exactMarker,
          { $unset: { archivedAt: "", archivedByOwnerId: "", archiveTransitionId: "", archiveTransitionExpiresAt: "" } },
          { new: true }
        );
        throw error;
      }
      try {
        await deps.disconnectStaffSockets(restaurantId);
      } catch (error) {
        // Realtime cleanup is best effort; the archived state remains authoritative.
        console.error("Không thể ngắt socket nhân viên của chi nhánh đã lưu trữ", error);
      }
      return { restaurantId, archivedAt: finalized.archivedAt };
      };
      return archiveWithinLease();
      });
    };

  return {
    archive,
    async restore(ownerId: string, restaurantId: string) {
      const filter = ownedFilter(ownerId, restaurantId);
      const restaurant = await findOwned(filter);
      if (await recoverPendingArchive(filter, restaurant)) return findOwned(filter);
      if (!restaurant.archivedAt) return restaurant;

      return deps.withQuotaLease(ownerId, async lease => {
        const current = await findOwned(filter);
        if (await recoverPendingArchive(filter, current)) return findOwned(filter);
        if (!current.archivedAt) return current;
        const limitError = await deps.checkPlanLimit(ownerId, "RESTAURANT_LIMIT");
        if (limitError) {
          throw new RestaurantArchiveError(403, limitError.message, {
            code: "PLAN_LIMIT_REACHED",
            limitType: "RESTAURANT_LIMIT",
            currentPlan: limitError.currentPlan,
            limitValue: limitError.limitValue,
            currentUsage: limitError.currentUsage,
            upgradeRequired: true
          });
        }
        const reservation = await lease.reserveRestaurantSlot();
        let writeStarted = false;
        try {
          await lease.assertHeld();
          writeStarted = true;
          const updated = await deps.Restaurant.findOneAndUpdate(
            { ...filter, archivedAt: { $ne: null } },
            { $unset: { archivedAt: "", archivedByOwnerId: "" } },
            { new: true }
          );
          if (updated) {
            try { await reservation.release(); } catch { /* The active restaurant is counted if cleanup is temporarily unavailable. */ }
            return updated;
          }
          const current = await findOwned(filter);
          if (!current.archivedAt) {
            try { await reservation.release(); } catch { /* The active restaurant is counted if cleanup is temporarily unavailable. */ }
            return current;
          }
          try { await reservation.release(); } catch { /* No branch was restored; reservation expires if cleanup is unavailable. */ }
          return current;
        } catch (error) {
          if (!writeStarted) {
            try { await reservation.release(); } catch { /* Reservation expires if cleanup is temporarily unavailable. */ }
          }
          throw error;
        }
      });
    }
  };
}

export const restaurantArchiveService = createRestaurantArchiveService();
