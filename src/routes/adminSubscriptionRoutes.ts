import { Router } from "express";
import mongoose from "mongoose";
import { Plan } from "../models/Plan.js";
import { Subscription, SubscriptionStatus, BillingCycle } from "../models/Subscription.js";
import { PaymentTransaction, PaymentStatus } from "../models/PaymentTransaction.js";
import { User, UserRole } from "../models/User.js";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth.js";
import { getOwnerUsage } from "../services/subscriptionService.js";

const router = Router();

type NormalizedPlanPayload = {
  name?: string;
  code?: string;
  description?: string;
  priceMonthly?: number;
  priceYearly?: number;
  restaurantLimit?: number;
  tableLimit?: number;
  menuItemLimit?: number;
  staffLimit?: number;
  scanLimitMonthly?: number;
  fitScoreEnabled?: boolean;
  foodAttributesEnabled?: boolean;
  recommendationEnabled?: boolean;
  personalizedMenuEnabled?: boolean;
  advancedAnalyticsEnabled?: boolean;
  customerInsightsEnabled?: boolean;
  features?: string[];
  unavailableFeatures?: string[];
  isPopular?: boolean;
  isActive?: boolean;
  sortOrder?: number;
};

const normalizeStringArray = (value: unknown, field: string, errors: string[]): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push(`${field} phải là mảng chuỗi`);
    return undefined;
  }
  return value.map((item) => item.trim()).filter(Boolean);
};

const normalizeNumber = (
  value: unknown,
  field: string,
  min: number,
  errors: string[]
): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    errors.push(`${field} phải là số >= ${min}`);
    return undefined;
  }
  return value;
};

const normalizeBoolean = (value: unknown, field: string, errors: string[]): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    errors.push(`${field} phải là boolean`);
    return undefined;
  }
  return value;
};

const normalizePlanPayload = (
  body: Record<string, unknown>,
  mode: "create" | "update"
): { payload: NormalizedPlanPayload; errors: string[] } => {
  const errors: string[] = [];
  const payload: NormalizedPlanPayload = {};

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (mode === "create" && !name) errors.push("name là bắt buộc");
  if (name) payload.name = name;

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (mode === "create" && !code) errors.push("code là bắt buộc");
  if (code) payload.code = code;

  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      errors.push("description phải là chuỗi");
    } else {
      payload.description = body.description.trim();
    }
  } else if (mode === "create") {
    payload.description = "";
  }

  const priceMonthly = normalizeNumber(body.priceMonthly, "priceMonthly", 0, errors);
  if (mode === "create" && body.priceMonthly === undefined) errors.push("priceMonthly là bắt buộc");
  if (priceMonthly !== undefined) payload.priceMonthly = priceMonthly;

  const priceYearly = normalizeNumber(body.priceYearly, "priceYearly", 0, errors);
  if (priceYearly !== undefined) payload.priceYearly = priceYearly;
  else if (mode === "create" && body.priceYearly === undefined) payload.priceYearly = 0;

  const limitFields = ["restaurantLimit", "tableLimit", "menuItemLimit", "staffLimit", "scanLimitMonthly"] as const;
  for (const field of limitFields) {
    const value = normalizeNumber(body[field], field, -1, errors);
    if (value !== undefined) payload[field] = value;
    else if (mode === "create" && body[field] === undefined) payload[field] = -1;
  }

  const aiFields = [
    "fitScoreEnabled",
    "foodAttributesEnabled",
    "recommendationEnabled",
    "personalizedMenuEnabled",
    "advancedAnalyticsEnabled",
    "customerInsightsEnabled"
  ] as const;
  for (const field of aiFields) {
    const value = normalizeBoolean(body[field], field, errors);
    if (value !== undefined) payload[field] = value;
    else if (mode === "create" && body[field] === undefined) payload[field] = false;
  }

  const features = normalizeStringArray(body.features, "features", errors);
  if (features !== undefined) payload.features = features;
  else if (mode === "create" && body.features === undefined) payload.features = [];

  const unavailableFeatures = normalizeStringArray(body.unavailableFeatures, "unavailableFeatures", errors);
  if (unavailableFeatures !== undefined) payload.unavailableFeatures = unavailableFeatures;
  else if (mode === "create" && body.unavailableFeatures === undefined) payload.unavailableFeatures = [];

  const isPopular = normalizeBoolean(body.isPopular, "isPopular", errors);
  if (isPopular !== undefined) payload.isPopular = isPopular;
  else if (mode === "create" && body.isPopular === undefined) payload.isPopular = false;

  const isActive = normalizeBoolean(body.isActive, "isActive", errors);
  if (isActive !== undefined) payload.isActive = isActive;
  else if (mode === "create" && body.isActive === undefined) payload.isActive = true;

  const sortOrder = normalizeNumber(body.sortOrder, "sortOrder", 0, errors);
  if (sortOrder !== undefined) payload.sortOrder = sortOrder;
  else if (mode === "create" && body.sortOrder === undefined) payload.sortOrder = 0;

  return { payload, errors };
};

// Áp dụng bảo vệ: Chỉ SUPER_ADMIN mới được phép sử dụng các endpoint này
router.use(requireAuth);
router.use(requireRole(UserRole.SUPER_ADMIN as string));

// GET /api/admin/subscription-revenue - Subscription payment revenue and transactions
router.get("/subscription-revenue", async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalAgg, monthAgg, statusAgg, revenueByPlanAgg, transactions] = await Promise.all([
      PaymentTransaction.aggregate([
        { $match: { status: PaymentStatus.PAID } },
        { $group: { _id: null, totalRevenue: { $sum: "$amount" }, paidCount: { $sum: 1 } } }
      ]),
      PaymentTransaction.aggregate([
        { $match: { status: PaymentStatus.PAID, updatedAt: { $gte: monthStart } } },
        { $group: { _id: null, monthRevenue: { $sum: "$amount" }, monthPaidCount: { $sum: 1 } } }
      ]),
      PaymentTransaction.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ]),
      PaymentTransaction.aggregate([
        { $match: { status: PaymentStatus.PAID } },
        { $group: { _id: "$planId", revenue: { $sum: "$amount" }, count: { $sum: 1 } } },
        {
          $lookup: {
            from: "plans",
            localField: "_id",
            foreignField: "_id",
            as: "plan"
          }
        },
        { $unwind: { path: "$plan", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            planId: "$_id",
            planName: "$plan.name",
            planCode: "$plan.code",
            revenue: 1,
            count: 1
          }
        },
        { $sort: { revenue: -1 } }
      ]),
      PaymentTransaction.find()
        .populate("ownerId", "username fullName email")
        .populate("planId", "name code")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean()
    ]);

    const counts = statusAgg.reduce<Record<string, number>>((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    res.json({
      totalRevenue: totalAgg[0]?.totalRevenue || 0,
      monthRevenue: monthAgg[0]?.monthRevenue || 0,
      paidCount: totalAgg[0]?.paidCount || 0,
      monthPaidCount: monthAgg[0]?.monthPaidCount || 0,
      pendingCount: counts[PaymentStatus.PENDING] || 0,
      cancelledCount: counts[PaymentStatus.CANCELLED] || 0,
      failedCount: counts[PaymentStatus.FAILED] || 0,
      revenueByPlan: revenueByPlanAgg,
      transactions: transactions.map((transaction: any) => ({
        id: transaction._id,
        orderCode: transaction.orderCode,
        amount: transaction.amount,
        status: transaction.status,
        paymentLinkId: transaction.paymentLinkId,
        checkoutUrl: transaction.checkoutUrl,
        owner: transaction.ownerId,
        plan: transaction.planId,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt
      }))
    });
  } catch (error: any) {
    console.error("Loi khi tai doanh thu subscription:", error);
    res.status(500).json({ message: "Loi he thong khi tai doanh thu subscription" });
  }
});

// ==========================================
// A. PLAN CRUD ROUTERS
// ==========================================

// 1. GET /api/admin/plans - Lấy toàn bộ danh sách các gói dịch vụ
router.get("/plans", async (req, res) => {
  try {
    const plans = await Plan.find().sort({ sortOrder: 1 });
    res.json(plans);
  } catch (error: any) {
    console.error("Lỗi khi tải danh sách gói dịch vụ:", error);
    res.status(500).json({ message: "Lỗi hệ thống khi tải gói dịch vụ" });
  }
});

// 2. POST /api/admin/plans - Tạo gói dịch vụ mới
router.post("/plans", async (req, res) => {
  try {
    const { payload, errors } = normalizePlanPayload(req.body, "create");
    if (errors.length > 0) {
      return res.status(400).json({
        message: "Dữ liệu gói dịch vụ không hợp lệ",
        errors
      });
    }

    const existingPlan = await Plan.findOne({ code: payload.code });
    if (existingPlan) {
      return res.status(409).json({ message: "Mã gói đã tồn tại" });
    }

    const plan = await Plan.create(payload);

    res.status(201).json({
      message: "Tạo gói dịch vụ thành công",
      plan
    });
  } catch (error: any) {
    console.error("Lỗi khi tạo gói dịch vụ:", error);
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Mã gói đã tồn tại" });
    }
    if (error?.name === "ValidationError") {
      return res.status(400).json({
        message: "Dữ liệu gói dịch vụ không hợp lệ",
        errors: Object.values(error.errors || {}).map((err: any) => err.message)
      });
    }
    res.status(500).json({ message: "Lỗi hệ thống khi tạo gói dịch vụ" });
  }
});

// 3. PATCH /api/admin/plans/:id - Sửa đổi gói dịch vụ
router.patch("/plans/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Mã gói dịch vụ không hợp lệ" });
    }

    const { payload, errors } = normalizePlanPayload(req.body, "update");
    if (errors.length > 0) {
      return res.status(400).json({
        message: "Dữ liệu gói dịch vụ không hợp lệ",
        errors
      });
    }
    delete payload.code;

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({ message: "Gói dịch vụ không tồn tại" });
    }

    if (payload.name !== undefined) plan.name = payload.name;
    if (payload.description !== undefined) plan.description = payload.description;
    if (payload.priceMonthly !== undefined) plan.priceMonthly = payload.priceMonthly;
    if (payload.priceYearly !== undefined) plan.priceYearly = payload.priceYearly;
    if (payload.restaurantLimit !== undefined) plan.restaurantLimit = payload.restaurantLimit;
    if (payload.tableLimit !== undefined) plan.tableLimit = payload.tableLimit;
    if (payload.menuItemLimit !== undefined) plan.menuItemLimit = payload.menuItemLimit;
    if (payload.staffLimit !== undefined) plan.staffLimit = payload.staffLimit;
    if (payload.scanLimitMonthly !== undefined) plan.scanLimitMonthly = payload.scanLimitMonthly;
    if (payload.fitScoreEnabled !== undefined) plan.fitScoreEnabled = payload.fitScoreEnabled;
    if (payload.foodAttributesEnabled !== undefined) plan.foodAttributesEnabled = payload.foodAttributesEnabled;
    if (payload.recommendationEnabled !== undefined) plan.recommendationEnabled = payload.recommendationEnabled;
    if (payload.personalizedMenuEnabled !== undefined) plan.personalizedMenuEnabled = payload.personalizedMenuEnabled;
    if (payload.advancedAnalyticsEnabled !== undefined) plan.advancedAnalyticsEnabled = payload.advancedAnalyticsEnabled;
    if (payload.customerInsightsEnabled !== undefined) plan.customerInsightsEnabled = payload.customerInsightsEnabled;
    if (payload.features !== undefined) plan.features = payload.features;
    if (payload.unavailableFeatures !== undefined) plan.unavailableFeatures = payload.unavailableFeatures;
    if (payload.isPopular !== undefined) plan.isPopular = payload.isPopular;
    if (payload.isActive !== undefined) plan.isActive = payload.isActive;
    if (payload.sortOrder !== undefined) plan.sortOrder = payload.sortOrder;

    await plan.save();

    res.json({
      message: "Cập nhật gói dịch vụ thành công",
      plan
    });
  } catch (error: any) {
    console.error("Lỗi khi cập nhật gói dịch vụ:", error);
    if (error?.name === "ValidationError") {
      return res.status(400).json({
        message: "Dữ liệu gói dịch vụ không hợp lệ",
        errors: Object.values(error.errors || {}).map((err: any) => err.message)
      });
    }
    res.status(500).json({ message: "Lỗi hệ thống khi sửa đổi gói dịch vụ" });
  }
});

// 4. PATCH /api/admin/plans/:id/toggle-active - Bật/Tắt gói dịch vụ
router.patch("/plans/:id/toggle-active", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Mã gói dịch vụ không hợp lệ" });
    }

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({ message: "Gói dịch vụ không tồn tại" });
    }

    plan.isActive = !plan.isActive;
    await plan.save();

    res.json({
      message: plan.isActive ? "Đã kích hoạt gói thành công" : "Đã tạm dừng hoạt động gói thành công",
      plan
    });
  } catch (error: any) {
    console.error("Lỗi khi thay đổi trạng thái hoạt động gói:", error);
    res.status(500).json({ message: "Lỗi hệ thống" });
  }
});

// 5. DELETE /api/admin/plans/:id - Xóa gói dịch vụ
router.delete("/plans/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Mã gói dịch vụ không hợp lệ" });
    }

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({ message: "Gói dịch vụ không tồn tại" });
    }

    // Không cho phép xóa gói FREE cốt lõi để tránh lỗi hệ thống
    if (plan.code === "FREE") {
      return res.status(400).json({ message: "Không thể xóa gói Starter/FREE mặc định của hệ thống" });
    }

    // Kiểm tra xem có subscription nào đang liên kết hay không
    const subCount = await Subscription.countDocuments({ planId: plan._id, status: SubscriptionStatus.ACTIVE });
    if (subCount > 0) {
      return res.status(400).json({
        message: `Không thể xóa gói này vì hiện tại có ${subCount} khách hàng đang sử dụng. Vui lòng tắt kích hoạt (deactivate) gói thay thế.`
      });
    }

    await Plan.findByIdAndDelete(id);

    res.json({
      message: "Xóa gói dịch vụ thành công"
    });
  } catch (error: any) {
    console.error("Lỗi khi xóa gói dịch vụ:", error);
    res.status(500).json({ message: "Lỗi hệ thống khi xóa gói dịch vụ" });
  }
});

// ==========================================
// B. SUBSCRIPTION OVERRIDE ROUTERS
// ==========================================

// 6. GET /api/admin/subscriptions - Xem toàn bộ lịch sử subscription của hệ thống
router.get("/subscriptions", async (req, res) => {
  try {
    const subscriptions = await Subscription.find()
      .populate("ownerId", "username fullName email phone")
      .populate("planId", "name code priceMonthly")
      .sort({ createdAt: -1 });
    
    res.json(subscriptions);
  } catch (error: any) {
    console.error("Lỗi khi lấy danh sách đăng ký gói:", error);
    res.status(500).json({ message: "Lỗi hệ thống khi tải danh sách subscription" });
  }
});

// 7. GET /api/admin/subscriptions/:ownerId - Xem chi tiết subscription và usage của một owner
router.get("/subscriptions/:ownerId", async (req, res) => {
  try {
    const { ownerId } = req.params;
    if (!mongoose.isValidObjectId(ownerId)) {
      return res.status(400).json({ message: "Mã chủ nhà hàng không hợp lệ" });
    }

    const sub = await Subscription.findOne({ ownerId }).sort({ createdAt: -1 })
      .populate("ownerId", "username fullName email phone")
      .populate("planId", "name code priceMonthly priceYearly restaurantLimit tableLimit menuItemLimit staffLimit features");

    if (!sub) {
      return res.status(404).json({ message: "Chủ nhà hàng chưa có gói dịch vụ nào" });
    }

    const usage = await getOwnerUsage(ownerId);

    res.json({
      subscription: sub,
      usage
    });
  } catch (error: any) {
    console.error("Lỗi khi tải chi tiết gói sử dụng:", error);
    res.status(500).json({ message: "Lỗi hệ thống" });
  }
});

// 8. PATCH /api/admin/subscriptions/:ownerId/plan - Thay đổi gói thủ công cho owner
router.patch("/subscriptions/:ownerId/plan", async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { planId, status, expiresAt } = req.body as {
      planId?: string;
      status?: SubscriptionStatus;
      expiresAt?: string;
    };

    if (!mongoose.isValidObjectId(ownerId)) {
      return res.status(400).json({ message: "Mã chủ nhà hàng không hợp lệ" });
    }

    const owner = await User.findById(ownerId);
    if (!owner || owner.role !== UserRole.RESTAURANT_OWNER) {
      return res.status(404).json({ message: "Không tìm thấy người dùng có vai trò chủ nhà hàng" });
    }

    let plan;
    if (planId) {
      if (!mongoose.isValidObjectId(planId)) {
        return res.status(400).json({ message: "Mã gói dịch vụ không hợp lệ" });
      }
      plan = await Plan.findById(planId);
      if (!plan) {
        return res.status(404).json({ message: "Gói dịch vụ không tồn tại" });
      }
    }

    // 1. Vô hiệu hóa tất cả các active subscription hiện tại của owner này
    await Subscription.updateMany(
      { ownerId: owner._id, status: SubscriptionStatus.ACTIVE },
      { $set: { status: SubscriptionStatus.CANCELLED } }
    );

    // 2. Tìm hoặc tạo mới subscription
    let sub = await Subscription.findOne({ ownerId: owner._id }).sort({ createdAt: -1 });

    const targetPlan = plan || (sub ? await Plan.findById(sub.planId) : await Plan.findOne({ code: "FREE" }));
    if (!targetPlan) {
      return res.status(400).json({ message: "Không thể xác định được gói dịch vụ mục tiêu" });
    }

    sub = await Subscription.create({
      ownerId: owner._id,
      planId: targetPlan._id,
      planCode: targetPlan.code,
      status: status || SubscriptionStatus.ACTIVE,
      billingCycle: BillingCycle.MONTHLY,
      amount: targetPlan.priceMonthly,
      startedAt: new Date(),
      expiresAt: expiresAt ? new Date(expiresAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // Mặc định 30 ngày
    });

    res.json({
      message: `Thay đổi gói sử dụng thành công cho chủ nhà hàng sang gói ${targetPlan.name}`,
      subscription: sub
    });
  } catch (error: any) {
    console.error("Lỗi khi Super Admin thay đổi gói của chủ nhà hàng:", error);
    res.status(500).json({ message: "Lỗi hệ thống khi thay đổi gói" });
  }
});

export default router;
