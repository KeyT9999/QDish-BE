import mongoose from "mongoose";
import { Plan, IPlan } from "../models/Plan.js";
import { Subscription, ISubscription, SubscriptionStatus, BillingCycle } from "../models/Subscription.js";
import { Restaurant } from "../models/Restaurant.js";
import { Table } from "../models/Table.js";
import { MenuItem } from "../models/MenuItem.js";
import { User, UserRole } from "../models/User.js";
import { TableSession, SessionCreatedBy } from "../models/TableSession.js";

// ──────────────────────────────────────────
// Plan Hierarchy
// ──────────────────────────────────────────

const PLAN_HIERARCHY: Record<string, number> = {
  FREE: 0,
  PLUS: 1,
  PRO: 2
};

/**
 * Trả về thứ bậc của gói: FREE=0, PLUS=1, PRO=2.
 * Gói không xác định mặc định = 0.
 */
export function getPlanHierarchyLevel(planCode: string): number {
  return PLAN_HIERARCHY[planCode?.toUpperCase()] ?? 0;
}

/**
 * Kiểm tra việc chuyển đổi từ fromPlanCode sang toPlanCode có phải là upgrade hay không.
 */
export function isUpgrade(fromPlanCode: string, toPlanCode: string): boolean {
  return getPlanHierarchyLevel(toPlanCode) > getPlanHierarchyLevel(fromPlanCode);
}

/**
 * Tính số ngày còn lại trước khi hết hạn.
 * Trả về -1 nếu không có expiresAt hoặc là gói FREE (vô thời hạn).
 */
export function calculateDaysRemaining(expiresAt?: Date | null, planCode?: string): number {
  if (!expiresAt || planCode?.toUpperCase() === "FREE") return -1;
  const now = new Date();
  const diff = expiresAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

/**
 * Xác định mức cảnh báo hết hạn.
 */
export function getExpiryWarningLevel(expiresAt?: Date | null, planCode?: string): string {
  if (!expiresAt || planCode?.toUpperCase() === "FREE") return "none";
  const days = calculateDaysRemaining(expiresAt, planCode);
  if (days <= 0) return "expired";
  if (days <= 1) return "1day";
  if (days <= 3) return "3days";
  if (days <= 7) return "7days";
  return "none";
}

/**
 * Trả về danh sách planCode mà owner có thể upgrade tới.
 */
export function getUpgradeablePlanCodes(currentPlanCode: string): string[] {
  const currentLevel = getPlanHierarchyLevel(currentPlanCode);
  return Object.entries(PLAN_HIERARCHY)
    .filter(([, level]) => level > currentLevel)
    .sort(([, a], [, b]) => a - b)
    .map(([code]) => code);
}

// ──────────────────────────────────────────
// Owner Subscription
// ──────────────────────────────────────────

/**
 * Lấy Subscription đang hoạt động (ACTIVE) của Owner.
 * Nếu không có, tự động tạo gói FREE ACTIVE cho Owner.
 * Nếu subscription đã hết hạn (expiresAt < now) → tự động downgrade về FREE.
 */
export async function getOwnerSubscription(ownerId: string | mongoose.Types.ObjectId): Promise<ISubscription> {
  const oid = typeof ownerId === "string" ? new mongoose.Types.ObjectId(ownerId) : ownerId;

  // Tìm subscription active
  let sub = await Subscription.findOne({
    ownerId: oid,
    status: SubscriptionStatus.ACTIVE
  });

  // Nếu có subscription ACTIVE nhưng đã hết hạn (và không phải FREE) → auto downgrade
  if (sub && sub.planCode !== "FREE" && sub.expiresAt && sub.expiresAt.getTime() < Date.now()) {
    console.log(`[SubscriptionService] Auto-downgrade: Owner ${oid} plan ${sub.planCode} expired at ${sub.expiresAt.toISOString()}`);
    sub.status = SubscriptionStatus.EXPIRED;
    await sub.save();
    sub = null; // Force creating FREE below
  }

  if (!sub) {
    // Tìm bất kỳ subscription nào của owner này
    const latestSub = await Subscription.findOne({ ownerId: oid }).sort({ createdAt: -1 });

    // Nếu hoàn toàn chưa có subscription nào, hoặc subscription đã EXPIRED/CANCELLED
    if (!latestSub || latestSub.status !== SubscriptionStatus.ACTIVE) {
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
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000), // 100 years
        lastWarningLevel: "none"
      });
    } else {
      sub = latestSub;
    }
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
  scanCount: number;
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

  // 5. Số lượt quét QR (TableSession CUSTOMER_SCAN trong tháng hiện tại)
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const scanCount = await TableSession.countDocuments({
    restaurantId: { $in: restaurantIds },
    createdBy: SessionCreatedBy.CUSTOMER_SCAN,
    createdAt: { $gte: startOfMonth }
  });

  return {
    restaurantCount,
    tableCount,
    menuItemCount,
    staffCount,
    scanCount
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
