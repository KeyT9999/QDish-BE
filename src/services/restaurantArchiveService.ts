import mongoose from "mongoose";
import { Restaurant } from "../models/Restaurant.js";
import { TableSession, TableSessionStatus } from "../models/TableSession.js";
import { Bill, BillStatus } from "../models/Bill.js";
import { checkPlanLimit } from "./subscriptionService.js";

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
};

const defaultDependencies: ArchiveDependencies = {
  Restaurant,
  TableSession,
  Bill,
  checkPlanLimit
};

export function createRestaurantArchiveService(deps: ArchiveDependencies = defaultDependencies) {
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

  return {
    async archive(ownerId: string, restaurantId: string) {
      const filter = ownedFilter(ownerId, restaurantId);
      const restaurant = await findOwned(filter);
      if (restaurant.archivedAt) {
        return { restaurantId, archivedAt: restaurant.archivedAt };
      }

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
          code: "RESTAURANT_HAS_OPEN_ACTIVITY",
          activeSessions,
          unpaidBills
        });
      }

      const updated = await deps.Restaurant.findOneAndUpdate(
        { ...filter, archivedAt: null },
        { $set: { archivedAt: new Date(), archivedByOwnerId: filter.ownerId } },
        { new: true }
      );
      if (updated?.archivedAt) {
        return { restaurantId, archivedAt: updated.archivedAt };
      }
      const current = await findOwned(filter);
      if (current.archivedAt) {
        return { restaurantId, archivedAt: current.archivedAt };
      }
      throw new RestaurantArchiveError(409, "Không thể lưu trữ chi nhánh do trạng thái đã thay đổi");
    },

    async restore(ownerId: string, restaurantId: string) {
      const filter = ownedFilter(ownerId, restaurantId);
      const restaurant = await findOwned(filter);
      if (!restaurant.archivedAt) return restaurant;

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

      const updated = await deps.Restaurant.findOneAndUpdate(
        { ...filter, archivedAt: { $ne: null } },
        { $unset: { archivedAt: "", archivedByOwnerId: "" } },
        { new: true }
      );
      return updated || findOwned(filter);
    }
  };
}

export const restaurantArchiveService = createRestaurantArchiveService();
