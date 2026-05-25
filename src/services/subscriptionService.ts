import mongoose from "mongoose";
import { Plan, IPlan } from "../models/Plan.js";
import { Subscription, ISubscription, SubscriptionStatus, BillingCycle } from "../models/Subscription.js";
import { Restaurant } from "../models/Restaurant.js";
import { Table } from "../models/Table.js";
import { MenuItem } from "../models/MenuItem.js";
import { User, UserRole } from "../models/User.js";

/**
 * Lấy Subscription đang hoạt động (ACTIVE) của Owner.
 * Nếu không có, tự động tạo gói FREE ACTIVE cho Owner.
 */
export async function getOwnerSubscription(ownerId: string | mongoose.Types.ObjectId): Promise<ISubscription> {
  const oid = typeof ownerId === "string" ? new mongoose.Types.ObjectId(ownerId) : ownerId;

  // Tìm subscription active hoặc pending_payment gần nhất
  // (Ưu tiên ACTIVE)
  let sub = await Subscription.findOne({
    ownerId: oid,
    status: SubscriptionStatus.ACTIVE
  });

  if (!sub) {
    // Tìm bất kỳ subscription nào của owner này
    sub = await Subscription.findOne({ ownerId: oid }).sort({ createdAt: -1 });
  }

  // Nếu hoàn toàn chưa có subscription nào, hoặc subscription đã EXPIRED/CANCELLED nhưng không có ACTIVE nào khác
  if (!sub || sub.status !== SubscriptionStatus.ACTIVE) {
    // Tìm plan FREE trong DB
    const freePlan = await Plan.findOne({ code: "FREE" });
    if (!freePlan) {
      throw new Error("Không tìm thấy cấu hình gói dịch vụ FREE trong cơ sở dữ liệu. Vui lòng chạy seed script.");
    }

    // Tạo gói FREE ACTIVE mới cho Owner
    sub = await Subscription.create({
      ownerId: oid,
      planId: freePlan._id,
      planCode: freePlan.code,
      status: SubscriptionStatus.ACTIVE,
      billingCycle: BillingCycle.MONTHLY,
      amount: 0,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000) // 100 years
    });
  }

  return sub;
}

/**
 * Lấy giới hạn và thông tin chi tiết của gói hiện tại của Owner.
 */
export async function getPlanLimits(ownerId: string | mongoose.Types.ObjectId): Promise<{ plan: IPlan; subscription: ISubscription }> {
  const subscription = await getOwnerSubscription(ownerId);
  const plan = await Plan.findById(subscription.planId);
  if (!plan) {
    throw new Error(`Không tìm thấy cấu hình gói với ID ${subscription.planId}`);
  }
  return { plan, subscription };
}

/**
 * Tìm OwnerID của nhà hàng từ restaurantId
 */
export async function resolveOwnerByRestaurant(restaurantId: string | mongoose.Types.ObjectId): Promise<mongoose.Types.ObjectId | null> {
  const rid = typeof restaurantId === "string" ? new mongoose.Types.ObjectId(restaurantId) : restaurantId;
  const restaurant = await Restaurant.findById(rid).select("ownerId");
  return restaurant?.ownerId ? new mongoose.Types.ObjectId(restaurant.ownerId) : null;
}

/**
 * Tính toán mức sử dụng hiện tại (Usage) của Owner
 */
export async function getOwnerUsage(ownerId: string | mongoose.Types.ObjectId): Promise<{
  restaurantCount: number;
  tableCount: number;
  menuItemCount: number;
  staffCount: number;
}> {
  const oid = typeof ownerId === "string" ? new mongoose.Types.ObjectId(ownerId) : ownerId;

  // 1. Số nhà hàng
  const restaurantCount = await Restaurant.countDocuments({ ownerId: oid });

  // Lấy danh sách ID của tất cả nhà hàng của owner này
  const restaurants = await Restaurant.find({ ownerId: oid }).select("_id");
  const restaurantIds = restaurants.map(r => r._id);

  // 2. Số lượng bàn
  const tableCount = await Table.countDocuments({ restaurantId: { $in: restaurantIds } });

  // 3. Số lượng món ăn
  const menuItemCount = await MenuItem.countDocuments({ restaurantId: { $in: restaurantIds } });

  // 4. Số lượng nhân viên (STAFF)
  const staffCount = await User.countDocuments({
    restaurantId: { $in: restaurantIds },
    role: UserRole.STAFF
  });

  return {
    restaurantCount,
    tableCount,
    menuItemCount,
    staffCount
  };
}

export type LimitType = "RESTAURANT_LIMIT" | "TABLE_LIMIT" | "MENU_ITEM_LIMIT" | "STAFF_LIMIT";

/**
 * Kiểm tra xem Owner có vượt quá giới hạn của gói cho tài nguyên xác định hay không.
 * Trả về chi tiết lỗi nếu vượt quá giới hạn, ngược lại trả về null.
 */
export async function checkPlanLimit(
  ownerId: string | mongoose.Types.ObjectId,
  limitType: LimitType
): Promise<{
  isLimitReached: boolean;
  message: string;
  limitType: string;
  currentPlan: string;
  limitValue: number;
  currentUsage: number;
} | null> {
  const oid = typeof ownerId === "string" ? new mongoose.Types.ObjectId(ownerId) : ownerId;

  // Lấy giới hạn gói và mức sử dụng hiện tại
  const { plan } = await getPlanLimits(oid);
  const usage = await getOwnerUsage(oid);

  let limitValue = -1;
  let currentUsage = 0;
  let resourceName = "";

  switch (limitType) {
    case "RESTAURANT_LIMIT":
      limitValue = plan.restaurantLimit;
      currentUsage = usage.restaurantCount;
      resourceName = "nhà hàng/chi nhánh";
      break;
    case "TABLE_LIMIT":
      limitValue = plan.tableLimit;
      currentUsage = usage.tableCount;
      resourceName = "bàn ăn";
      break;
    case "MENU_ITEM_LIMIT":
      limitValue = plan.menuItemLimit;
      currentUsage = usage.menuItemCount;
      resourceName = "món ăn";
      break;
    case "STAFF_LIMIT":
      limitValue = plan.staffLimit;
      currentUsage = usage.staffCount;
      resourceName = "nhân viên";
      break;
  }

  // Nếu limitValue === -1 có nghĩa là không giới hạn
  if (limitValue !== -1 && currentUsage >= limitValue) {
    return {
      isLimitReached: true,
      message: `Bạn đã đạt giới hạn ${limitValue} ${resourceName} của gói ${plan.name}. Vui lòng nâng cấp gói để tiếp tục tạo thêm.`,
      limitType,
      currentPlan: plan.code,
      limitValue,
      currentUsage
    };
  }

  return null;
}
