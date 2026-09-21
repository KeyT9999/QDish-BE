import { Router } from "express";
import mongoose from "mongoose";
import { Plan } from "../models/Plan.js";
import { Subscription, SubscriptionStatus, BillingCycle } from "../models/Subscription.js";
import { PaymentTransaction, PaymentStatus } from "../models/PaymentTransaction.js";
import { AuthRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { UserRole, User } from "../models/User.js";
import payOS, { isPayOSConfigured } from "../services/payosService.js";
import {
  getOwnerSubscription,
  getPlanLimits,
  getOwnerUsage,
  checkPlanLimit,
  getPlanHierarchyLevel,
  isUpgrade,
  calculateDaysRemaining,
  getExpiryWarningLevel,
  getUpgradeablePlanCodes
} from "../services/subscriptionService.js";
import { createSystemNotification } from "../services/notificationService.js";
import { NotificationType, NotificationPriority } from "../models/Notification.js";

const router = Router();

const getSubscriptionExpiry = (billingCycle: BillingCycle) => {
  const durationMs = billingCycle === BillingCycle.YEARLY
    ? 365 * 24 * 60 * 60 * 1000
    : 30 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + durationMs);
};

const createUniqueOrderCode = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const orderCode = Number(`${Date.now().toString().slice(-9)}${Math.floor(100 + Math.random() * 900)}`);
    const exists = await PaymentTransaction.exists({ orderCode });
    if (!exists) return orderCode;
  }
  throw new Error("Khong the tao ma thanh toan duy nhat. Vui long thu lai.");
};

const activatePaidSubscription = async (transaction: any, rawResponse?: any) => {
  if (transaction.status !== PaymentStatus.PAID) {
    transaction.status = PaymentStatus.PAID;
    transaction.payosRawResponse = rawResponse || transaction.payosRawResponse;
    await transaction.save();
  }

  const sub = await Subscription.findById(transaction.subscriptionId);
  if (!sub) return null;

  if (sub.status !== SubscriptionStatus.ACTIVE) {
    await Subscription.updateMany(
      { ownerId: sub.ownerId, _id: { $ne: sub._id }, status: SubscriptionStatus.ACTIVE },
      { $set: { status: SubscriptionStatus.CANCELLED } }
    );

    sub.planId = transaction.planId;
    const plan = await Plan.findById(transaction.planId).select("code");
    if (plan) sub.planCode = plan.code;
    sub.status = SubscriptionStatus.ACTIVE;
    sub.amount = transaction.amount;
    sub.startedAt = new Date();
    sub.expiresAt = getSubscriptionExpiry(sub.billingCycle);
    await sub.save();
  }

  return sub;
};

const cancelPendingPayment = async (transaction: any, rawResponse?: any) => {
  if (transaction.status === PaymentStatus.PAID) {
    return;
  }

  transaction.status = PaymentStatus.CANCELLED;
  transaction.payosRawResponse = rawResponse || transaction.payosRawResponse;
  await transaction.save();

  const sub = await Subscription.findById(transaction.subscriptionId);
  if (sub && sub.status === SubscriptionStatus.PENDING_PAYMENT) {
    sub.status = SubscriptionStatus.CANCELLED;
    await sub.save();
  }
};

// ==========================================
// 1. PUBLIC ROUTES
// ==========================================

// GET /api/plans - Lấy danh sách các gói dịch vụ đang active
router.get("/plans", async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1 });
    res.json({ plans });
  } catch (error: any) {
    console.error("Lỗi khi lấy danh sách gói dịch vụ:", error);
    res.status(500).json({ message: "Lỗi hệ thống khi tải danh sách gói dịch vụ" });
  }
});

// ==========================================
// 2. OWNER SUBSCRIPTION ROUTES (Yêu cầu đăng nhập, vai trò OWNER)
// ==========================================

// GET /api/owner/subscription - Lấy gói hiện tại + thống kê usage của owner
router.get(
  "/owner/subscription",
  requireAuth,
  requireRole(UserRole.RESTAURANT_OWNER as string),
  async (req: AuthRequest, res) => {
    try {
      const ownerId = req.auth?.sub;
      if (!ownerId) {
        return res.status(403).json({ message: "Không xác định được thông tin chủ nhà hàng" });
      }

      // 1. Lấy thông tin gói
      const { plan, subscription } = await getPlanLimits(ownerId);

      // 2. Lấy usage hiện tại
      const usage = await getOwnerUsage(ownerId);

      const daysRemaining = calculateDaysRemaining(subscription.expiresAt, subscription.planCode);
      let expiryWarningLevel = getExpiryWarningLevel(subscription.expiresAt, subscription.planCode);

      if (subscription.planCode === "FREE") {
        const lastExpired = await Subscription.findOne({
          ownerId: ownerId,
          status: SubscriptionStatus.EXPIRED,
          planCode: { $ne: "FREE" }
        }).sort({ updatedAt: -1 });

        if (lastExpired && (Date.now() - lastExpired.updatedAt.getTime() < 7 * 24 * 60 * 60 * 1000)) {
          expiryWarningLevel = "expired";
        }
      }

      const canUpgradeTo = getUpgradeablePlanCodes(subscription.planCode);

      res.json({
        subscription: {
          id: subscription._id,
          planId: subscription.planId,
          planName: plan.name,
          planCode: subscription.planCode,
          plan,
          status: subscription.status,
          billingCycle: subscription.billingCycle,
          amount: subscription.amount,
          startedAt: subscription.startedAt,
          expiresAt: subscription.expiresAt,
          daysRemaining,
          expiryWarningLevel,
          canUpgradeTo
        },
        limits: {
          restaurantLimit: plan.restaurantLimit,
          tableLimit: plan.tableLimit,
          menuItemLimit: plan.menuItemLimit,
          staffLimit: plan.staffLimit,
          scanLimitMonthly: plan.scanLimitMonthly !== undefined ? plan.scanLimitMonthly : -1,
          fitScoreEnabled: plan.fitScoreEnabled || false,
          foodAttributesEnabled: plan.foodAttributesEnabled || false,
          recommendationEnabled: plan.recommendationEnabled || false,
          personalizedMenuEnabled: plan.personalizedMenuEnabled || false,
          advancedAnalyticsEnabled: plan.advancedAnalyticsEnabled || false,
          customerInsightsEnabled: plan.customerInsightsEnabled || false,
          customerCrmEnabled: plan.customerCrmEnabled || false,
          features: plan.features
        },
        usage: {
          restaurantCount: usage.restaurantCount,
          tableCount: usage.tableCount,
          menuItemCount: usage.menuItemCount,
          staffCount: usage.staffCount,
          scanCount: usage.scanCount
        }
      });
    } catch (error: any) {
      console.error("Lỗi khi tải thông tin subscription:", error);
      res.status(500).json({ message: error.message || "Lỗi hệ thống khi tải thông tin gói sử dụng" });
    }
  }
);

// ==============================================================================
// MODULAR HANDLERS & DEPENDENCY INJECTION FOR SUBSCRIPTION CHECKOUT & STATUS
// ==============================================================================

export interface SubscriptionCheckoutDeps {
  Plan: any;
  Subscription: any;
  PaymentTransaction: any;
  getOwnerSubscription: (ownerId: string | mongoose.Types.ObjectId) => Promise<any>;
  isUpgrade: (current: string, next: string) => boolean;
  createUniqueOrderCode: () => Promise<number>;
  payOSCreatePayment: (paymentData: any) => Promise<any>;
  isPayOSConfigured: boolean;
  appBaseUrl: string;
}

export function createCheckoutHandler(customDeps?: Partial<SubscriptionCheckoutDeps>) {
  const deps: SubscriptionCheckoutDeps = {
    Plan,
    Subscription,
    PaymentTransaction,
    getOwnerSubscription,
    isUpgrade,
    createUniqueOrderCode,
    payOSCreatePayment: (data: any) => payOS.paymentRequests.create(data),
    isPayOSConfigured,
    appBaseUrl: process.env.APP_BASE_URL || "http://localhost:5173",
    ...customDeps
  };

  return async (req: AuthRequest, res: any) => {
    try {
      const ownerId = req.auth?.sub;
      if (!ownerId) {
        return res.status(403).json({ message: "Không xác định được thông tin chủ nhà hàng" });
      }

      const { planId, billingCycle } = req.body as { planId?: string; billingCycle?: BillingCycle };

      if (!planId) {
        return res.status(400).json({ message: "Thiếu thông tin planId" });
      }

      if (!mongoose.isValidObjectId(planId)) {
        return res.status(400).json({ message: "planId khong hop le" });
      }

      if (billingCycle && !Object.values(BillingCycle).includes(billingCycle)) {
        return res.status(400).json({ message: "Chu kỳ thanh toán không hợp lệ" });
      }

      const cycle = billingCycle || BillingCycle.MONTHLY;

      // 1. Tìm plan trong DB
      const plan = await deps.Plan.findById(planId);
      if (!plan) {
        return res.status(404).json({ message: "Gói dịch vụ không tồn tại" });
      }

      if (!plan.isActive) {
        return res.status(400).json({ message: "Gói dịch vụ hiện không khả dụng" });
      }

      // ========== UPGRADE-ONLY VALIDATION ==========
      // Lấy subscription hiện tại để kiểm tra hướng chuyển đổi
      const currentSub = await deps.getOwnerSubscription(ownerId);
      const currentPlanCode = currentSub.planCode;

      // Không cho phép downgrade (PLUS→FREE, PRO→PLUS, PRO→FREE)
      if (!deps.isUpgrade(currentPlanCode, plan.code) && currentPlanCode !== plan.code) {
        return res.status(400).json({
          message: `Không thể chuyển từ gói ${currentPlanCode} xuống gói ${plan.code}. Nếu muốn hạ gói, vui lòng chờ hết hạn hoặc liên hệ Super Admin.`,
          code: "DOWNGRADE_NOT_ALLOWED"
        });
      }

      // Xác định số tiền
      const amount = cycle === BillingCycle.YEARLY ? plan.priceYearly : plan.priceMonthly;

      // 2. Nếu là gói FREE (0đ): Chỉ cho phép nếu chưa có gói hoặc đang FREE
      if (amount === 0) {
        if (currentPlanCode !== "FREE") {
          return res.status(400).json({
            message: `Không thể chuyển từ gói ${currentPlanCode} xuống gói FREE. Vui lòng chờ hết hạn hoặc liên hệ Super Admin.`,
            code: "DOWNGRADE_NOT_ALLOWED"
          });
        }

        return res.json({
          message: "Bạn đang sử dụng gói miễn phí.",
          isFree: true,
          subscription: currentSub
        });
      }

      // 3. Với gói có phí (> 0đ): Tạo PayOS Payment Link hoặc Sandbox Fallback
      const orderCode = await deps.createUniqueOrderCode();
      const appBaseUrl = deps.appBaseUrl;
      const cleanDesc = `QDish SaaS ${plan.code}`.replace(/[^a-zA-Z0-9 ]/g, "").substring(0, 30);

      const paymentData = {
        orderCode,
        amount,
        description: cleanDesc,
        cancelUrl: process.env.PAYOS_CANCEL_URL || `${appBaseUrl}/payment-cancel`,
        returnUrl: process.env.PAYOS_RETURN_URL || `${appBaseUrl}/payment-success`,
        items: [
          {
            name: `Goi QDish ${plan.name} (${cycle === BillingCycle.YEARLY ? "Nam" : "Thang"})`,
            quantity: 1,
            price: amount
          }
        ]
      };

      console.log("Creating subscription checkout", {
        orderCode,
        ownerId,
        planCode: plan.code,
        billingCycle: cycle,
        amount
      });

      let payosResponse: any = null;
      let isSandbox = false;
      let gatewayNotice: string | undefined;

      if (deps.isPayOSConfigured) {
        try {
          payosResponse = await deps.payOSCreatePayment(paymentData);
          if (!payosResponse || !payosResponse.checkoutUrl) {
            throw new Error("Không nhận được liên kết thanh toán từ cổng PayOS");
          }
        } catch (payosError: any) {
          console.warn(`[SubscriptionCheckout] PayOS gateway rejected (code: ${payosError?.code || "N/A"}, message: ${payosError?.message}). Switching to Sandbox Checkout.`);
          isSandbox = true;
          gatewayNotice = payosError?.message || "Cổng PayOS tạm thời không khả dụng, đã chuyển sang cổng thử nghiệm Sandbox.";
        }
      } else {
        isSandbox = true;
        gatewayNotice = "PayOS chưa cấu hình đầy đủ, kích hoạt cổng thanh toán Sandbox.";
      }

      const checkoutUrl = isSandbox
        ? `${appBaseUrl}/payment-checkout?orderCode=${orderCode}`
        : payosResponse.checkoutUrl;

      const qrCode = isSandbox
        ? `https://img.vietqr.io/image/970422-0905123456-compact2.png?amount=${amount}&addInfo=QDISH%20${orderCode}&accountName=QDISH%20SAAS`
        : payosResponse.qrCode;

      const paymentLinkId = isSandbox
        ? `sandbox_${orderCode}`
        : payosResponse.paymentLinkId;

      const paymentStatus = isSandbox
        ? PaymentStatus.PENDING
        : (payosResponse.status || PaymentStatus.PENDING);

      // 4. Tạo/Cập nhật Subscription dạng PENDING_PAYMENT
      const subscription = await deps.Subscription.create({
        ownerId,
        planId: plan._id,
        planCode: plan.code,
        status: SubscriptionStatus.PENDING_PAYMENT,
        billingCycle: cycle,
        amount,
        paymentOrderCode: orderCode,
        payosPaymentLinkId: paymentLinkId
      });

      // 5. Tạo PaymentTransaction PENDING
      await deps.PaymentTransaction.create({
        ownerId,
        planId: plan._id,
        subscriptionId: subscription._id,
        orderCode,
        amount,
        status: PaymentStatus.PENDING,
        paymentLinkId,
        checkoutUrl,
        qrCode,
        payosRawResponse: isSandbox ? { mode: "SANDBOX_FALLBACK", notice: gatewayNotice } : payosResponse
      });

      res.json({
        checkoutUrl,
        qrCode,
        paymentLinkId,
        orderCode,
        amount,
        status: paymentStatus,
        isSandbox,
        gatewayNotice,
        planName: plan.name,
        planCode: plan.code
      });
    } catch (error: any) {
      console.error("Lỗi khi tạo checkout subscription:", error);
      res.status(500).json({ message: error.message || "Lỗi hệ thống khi khởi tạo thanh toán" });
    }
  };
}

export function createCheckoutDetailsHandler(customDeps?: any) {
  const deps = {
    PaymentTransaction,
    Plan,
    Subscription,
    ...customDeps
  };

  return async (req: AuthRequest, res: any) => {
    try {
      const ownerId = req.auth?.sub;
      const { orderCode } = req.query;

      if (!orderCode) {
        return res.status(400).json({ message: "Thiếu tham số orderCode" });
      }

      const oCode = Number(orderCode);
      if (isNaN(oCode)) {
        return res.status(400).json({ message: "orderCode không hợp lệ" });
      }

      const transaction = await deps.PaymentTransaction.findOne({ orderCode: oCode, ownerId });
      if (!transaction) {
        return res.status(404).json({ message: "Không tìm thấy thông tin giao dịch thanh toán" });
      }

      const plan = await deps.Plan.findById(transaction.planId);
      const sub = await deps.Subscription.findById(transaction.subscriptionId);

      const isSandbox = transaction.paymentLinkId?.startsWith("sandbox_") ||
        Boolean(transaction.payosRawResponse?.mode?.includes("SANDBOX"));

      res.json({
        orderCode: transaction.orderCode,
        amount: transaction.amount,
        status: transaction.status,
        qrCode: transaction.qrCode,
        checkoutUrl: transaction.checkoutUrl,
        isSandbox,
        plan: plan ? {
          name: plan.name,
          code: plan.code,
          description: plan.description,
          features: plan.features
        } : null,
        billingCycle: sub?.billingCycle || BillingCycle.MONTHLY,
        createdAt: transaction.createdAt
      });
    } catch (error: any) {
      console.error("Lỗi khi lấy chi tiết thanh toán:", error);
      res.status(500).json({ message: error.message || "Lỗi hệ thống khi lấy chi tiết thanh toán" });
    }
  };
}

export function createSandboxConfirmHandler(customDeps?: any) {
  const deps = {
    PaymentTransaction,
    activatePaidSubscription,
    ...customDeps
  };

  return async (req: AuthRequest, res: any) => {
    try {
      const ownerId = req.auth?.sub;
      const { orderCode } = req.body;

      if (!orderCode) {
        return res.status(400).json({ message: "Thiếu tham số orderCode" });
      }

      const oCode = Number(orderCode);
      if (isNaN(oCode)) {
        return res.status(400).json({ message: "orderCode không hợp lệ" });
      }

      const transaction = await deps.PaymentTransaction.findOne({ orderCode: oCode, ownerId });
      if (!transaction) {
        return res.status(404).json({ message: "Không tìm thấy giao dịch thanh toán này" });
      }

      if (transaction.status === PaymentStatus.PAID) {
        return res.json({
          success: true,
          message: "Giao dịch đã được thanh toán và kích hoạt trước đó.",
          status: "PAID",
          orderCode: oCode
        });
      }

      const sub = await deps.activatePaidSubscription(transaction, {
        mode: "SANDBOX_CONFIRMED",
        confirmedAt: new Date(),
        confirmedBy: ownerId
      });

      res.json({
        success: true,
        message: "Xác nhận thanh toán mô phỏng thành công! Gói dịch vụ đã được kích hoạt.",
        orderCode: oCode,
        status: "PAID",
        subscription: sub
      });
    } catch (error: any) {
      console.error("Lỗi khi xác nhận thanh toán Sandbox:", error);
      res.status(500).json({ message: error.message || "Lỗi khi xác nhận thanh toán Sandbox" });
    }
  };
}

export function createCancelCheckoutHandler(customDeps?: any) {
  const deps = {
    PaymentTransaction,
    cancelPendingPayment,
    ...customDeps
  };

  return async (req: AuthRequest, res: any) => {
    try {
      const ownerId = req.auth?.sub;
      const { orderCode } = req.body;

      if (!orderCode) {
        return res.status(400).json({ message: "Thiếu tham số orderCode" });
      }

      const oCode = Number(orderCode);
      if (isNaN(oCode)) {
        return res.status(400).json({ message: "orderCode không hợp lệ" });
      }

      const transaction = await deps.PaymentTransaction.findOne({ orderCode: oCode, ownerId });
      if (!transaction) {
        return res.status(404).json({ message: "Không tìm thấy giao dịch thanh toán" });
      }

      if (transaction.status === PaymentStatus.PAID) {
        return res.status(400).json({ message: "Giao dịch đã thanh toán thành công, không thể hủy" });
      }

      await deps.cancelPendingPayment(transaction, {
        mode: "OWNER_CANCELLED",
        cancelledAt: new Date()
      });

      res.json({
        success: true,
        message: "Giao dịch đã được hủy bỏ.",
        status: "CANCELLED"
      });
    } catch (error: any) {
      console.error("Lỗi khi hủy giao dịch thanh toán:", error);
      res.status(500).json({ message: error.message || "Lỗi khi hủy giao dịch thanh toán" });
    }
  };
}

export function createPaymentStatusHandler(customDeps?: any) {
  const deps = {
    PaymentTransaction,
    payOSGetPayment: (orderCode: number) => payOS.paymentRequests.get(orderCode),
    activatePaidSubscription,
    cancelPendingPayment,
    ...customDeps
  };

  return async (req: AuthRequest, res: any) => {
    try {
      const { orderCode } = req.query;
      if (!orderCode) {
        return res.status(400).json({ message: "Thiếu tham số orderCode" });
      }

      const oCode = Number(orderCode);
      if (isNaN(oCode)) {
        return res.status(400).json({ message: "orderCode không hợp lệ" });
      }

      // 1. Tìm PaymentTransaction trong DB
      const ownerId = req.auth?.sub;
      const transaction = await deps.PaymentTransaction.findOne({ orderCode: oCode, ownerId });
      if (!transaction) {
        return res.status(404).json({ message: "Không tìm thấy giao dịch thanh toán này" });
      }

      // 2. Kiểm tra trạng thái đã hoàn tất trong DB
      if (transaction.status === PaymentStatus.PAID) {
        return res.json({
          status: "PAID",
          message: "Thanh toán đã được xác nhận và gói đã được kích hoạt."
        });
      }

      if (transaction.status === PaymentStatus.CANCELLED || transaction.status === PaymentStatus.FAILED) {
        return res.json({
          status: transaction.status === PaymentStatus.FAILED ? "FAILED" : "CANCELLED",
          message: "Giao dịch đã bị hủy hoặc thất bại."
        });
      }

      // Nếu là giao dịch Sandbox, không gọi PayOS API ngoài
      const isSandbox = transaction.paymentLinkId?.startsWith("sandbox_") ||
        Boolean(transaction.payosRawResponse?.mode?.includes("SANDBOX"));

      if (isSandbox) {
        return res.json({
          status: transaction.status,
          isSandbox: true,
          message: "Đang chờ xác nhận thanh toán (Sandbox Demo)."
        });
      }

      // Gọi PayOS kiểm tra trạng thái thực tế
      try {
        const payosInfo = await deps.payOSGetPayment(oCode);
        console.log(`PayOS status for order ${oCode}:`, payosInfo?.status);

        if (payosInfo?.status === "PAID") {
          await deps.activatePaidSubscription(transaction, payosInfo);
          return res.json({
            status: "PAID",
            message: "Thanh toán thành công và gói đã được kích hoạt!"
          });
        }

        if (payosInfo?.status === "CANCELLED" || payosInfo?.status === "EXPIRED") {
          await deps.cancelPendingPayment(transaction, payosInfo);
          return res.json({
            status: payosInfo.status,
            message: "Giao dịch đã bị hủy bỏ hoặc hết hạn."
          });
        }
      } catch (payosErr: any) {
        console.warn(`[PaymentStatus] Không thể truy vấn PayOS cho đơn ${oCode}:`, payosErr?.message);
      }

      // Mặc định trả về trạng thái hiện tại (PENDING)
      res.json({
        status: "PENDING",
        message: "Đang chờ khách hàng thanh toán."
      });
    } catch (error: any) {
      console.error("Lỗi khi kiểm tra trạng thái thanh toán:", error);
      res.status(500).json({ message: error.message || "Lỗi hệ thống khi kiểm tra trạng thái" });
    }
  };
}

// POST /api/owner/subscription/checkout - Tạo link thanh toán PayOS để mua/nâng cấp gói
router.post(
  "/owner/subscription/checkout",
  requireAuth,
  requireRole(UserRole.RESTAURANT_OWNER as string),
  createCheckoutHandler()
);

// GET /api/owner/subscription/checkout-details - Lấy chi tiết đơn thanh toán để hiển thị giao diện checkout
router.get(
  "/owner/subscription/checkout-details",
  requireAuth,
  requireRole(UserRole.RESTAURANT_OWNER as string),
  createCheckoutDetailsHandler()
);

// POST /api/owner/subscription/sandbox-confirm - Xác nhận thanh toán Sandbox để nghiệm thu / demo
router.post(
  "/owner/subscription/sandbox-confirm",
  requireAuth,
  requireRole(UserRole.RESTAURANT_OWNER as string),
  createSandboxConfirmHandler()
);

// POST /api/owner/subscription/cancel-checkout - Hủy đơn thanh toán subscription
router.post(
  "/owner/subscription/cancel-checkout",
  requireAuth,
  requireRole(UserRole.RESTAURANT_OWNER as string),
  createCancelCheckoutHandler()
);

// GET /api/owner/subscription/payment-status - Kiểm tra và cập nhật trạng thái thanh toán theo orderCode
router.get(
  "/owner/subscription/payment-status",
  requireAuth,
  requireRole(UserRole.RESTAURANT_OWNER as string),
  createPaymentStatusHandler()
);

// ==========================================
// 3. WEBHOOK ROUTE (Công khai, PayOS POST trực tiếp)
// ==========================================

// POST /api/payments/payos-webhook - Tiếp nhận callback từ PayOS
router.post("/payments/payos-webhook", async (req, res) => {
  try {
    const webhookData = req.body;
    console.log("Received PayOS webhook", {
      orderCode: webhookData?.data?.orderCode,
      success: webhookData?.success,
      code: webhookData?.data?.code || webhookData?.code
    });

    // Verify webhook signature bằng CHECKSUM_KEY
    let verifiedData;
    try {
      verifiedData = await payOS.webhooks.verify(webhookData);
    } catch (err) {
      console.error("❌ Webhook verification signature failed:", err);
      return res.status(400).json({ message: "Chữ ký webhook không hợp lệ" });
    }

    const { orderCode, code } = verifiedData;
    const isSuccess = code === "00";
    console.log(`Webhook verified successfully for order ${orderCode}. Code = ${code}, isSuccess = ${isSuccess}`);

    // Tìm Giao dịch trong DB
    const transaction = await PaymentTransaction.findOne({ orderCode });
    if (!transaction) {
      console.warn(`⚠️ Transaction not found for orderCode: ${orderCode}`);
      return res.status(200).json({ message: "Không tìm thấy orderCode trong hệ thống" });
    }

    if (isSuccess) {
      const paidSub = await activatePaidSubscription(transaction, webhookData);
      if (paidSub) {
        console.log(`Activated plan ${paidSub.planCode} for ownerId ${paidSub.ownerId}`);
        // Auto notification: payment success
        try {
          await createSystemNotification({
            title: "Thanh to\u00e1n th\u00e0nh c\u00f4ng",
            message: `G\u00f3i ${paidSub.planCode} \u0111\u00e3 \u0111\u01b0\u1ee3c k\u00edch ho\u1ea1t th\u00e0nh c\u00f4ng!`,
            type: NotificationType.PAYMENT,
            priority: NotificationPriority.NORMAL,
            recipientUserIds: [paidSub.ownerId],
            ownerId: paidSub.ownerId,
            subscriptionId: paidSub._id as any,
            paymentTransactionId: transaction._id as any,
            actionUrl: "/owner?tab=billing"
          });
        } catch (notifErr) {
          console.error("Kh\u00f4ng th\u1ec3 g\u1eedi notification thanh to\u00e1n th\u00e0nh c\u00f4ng", notifErr);
        }
      }
      return res.json({ success: true });
    } else {
      // Giao dịch thất bại / hủy bỏ
      if (transaction.status === PaymentStatus.PAID) {
        return res.json({ success: true });
      }

      transaction.status = PaymentStatus.CANCELLED;
      await transaction.save();

      const sub = await Subscription.findById(transaction.subscriptionId);
      if (sub && sub.status === SubscriptionStatus.PENDING_PAYMENT) {
        sub.status = SubscriptionStatus.CANCELLED;
        await sub.save();
      }
      console.log(`❌ Cancelled transaction for orderCode ${orderCode}`);

      // Auto notification: payment cancelled
      try {
        await createSystemNotification({
          title: "Thanh to\u00e1n th\u1ea5t b\u1ea1i",
          message: `Giao d\u1ecbch thanh to\u00e1n \u0111\u00e3 b\u1ecb h\u1ee7y. Vui l\u00f2ng th\u1eed l\u1ea1i.`,
          type: NotificationType.PAYMENT,
          priority: NotificationPriority.HIGH,
          recipientUserIds: [transaction.ownerId],
          ownerId: transaction.ownerId,
          subscriptionId: transaction.subscriptionId,
          paymentTransactionId: transaction._id as any,
          actionUrl: "/owner?tab=billing"
        });
      } catch (notifErr) {
        console.error("Kh\u00f4ng th\u1ec3 g\u1eedi notification thanh to\u00e1n th\u1ea5t b\u1ea1i", notifErr);
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Lỗi khi xử lý PayOS webhook:", error);
    res.status(500).json({ message: "Lỗi hệ thống xử lý callback webhook" });
  }
});

export default router;
