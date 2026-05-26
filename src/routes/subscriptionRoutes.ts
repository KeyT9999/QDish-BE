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
  checkPlanLimit
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
          expiresAt: subscription.expiresAt
        },
        limits: {
          restaurantLimit: plan.restaurantLimit,
          tableLimit: plan.tableLimit,
          menuItemLimit: plan.menuItemLimit,
          staffLimit: plan.staffLimit,
          features: plan.features
        },
        usage: {
          restaurantCount: usage.restaurantCount,
          tableCount: usage.tableCount,
          menuItemCount: usage.menuItemCount,
          staffCount: usage.staffCount
        }
      });
    } catch (error: any) {
      console.error("Lỗi khi tải thông tin subscription:", error);
      res.status(500).json({ message: error.message || "Lỗi hệ thống khi tải thông tin gói sử dụng" });
    }
  }
);

// POST /api/owner/subscription/checkout - Tạo link thanh toán PayOS để mua/nâng cấp gói
router.post(
  "/owner/subscription/checkout",
  requireAuth,
  requireRole(UserRole.RESTAURANT_OWNER as string),
  async (req: AuthRequest, res) => {
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
      const plan = await Plan.findById(planId);
      if (!plan) {
        return res.status(404).json({ message: "Gói dịch vụ không tồn tại" });
      }

      if (!plan.isActive) {
        return res.status(400).json({ message: "Gói dịch vụ hiện không khả dụng" });
      }

      // Xác định số tiền
      const amount = cycle === BillingCycle.YEARLY ? plan.priceYearly : plan.priceMonthly;

      // 2. Nếu là gói FREE (0đ): Cập nhật trực tiếp
      if (amount === 0) {
        // Hủy hoặc đổi subscription hiện tại thành FREE ACTIVE
        let sub = await Subscription.findOne({ ownerId, status: SubscriptionStatus.ACTIVE });
        if (sub) {
          sub.planId = plan._id as mongoose.Types.ObjectId;
          sub.planCode = plan.code;
          sub.amount = 0;
          sub.billingCycle = cycle;
          sub.startedAt = new Date();
          sub.expiresAt = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000); // 100 năm
          await sub.save();
        } else {
          sub = await Subscription.create({
            ownerId,
            planId: plan._id,
            planCode: plan.code,
            status: SubscriptionStatus.ACTIVE,
            billingCycle: cycle,
            amount: 0,
            startedAt: new Date(),
            expiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000)
          });
        }

        return res.json({
          message: "Kích hoạt gói miễn phí thành công",
          isFree: true,
          subscription: sub
        });
      }

      // 3. Với gói có phí (> 0đ): Tạo PayOS Payment Link
      // Tạo orderCode unique, bắt buộc là số nguyên (max safe integer là 9007199254740991)
      if (!isPayOSConfigured) {
        return res.status(500).json({ message: "Cau hinh PayOS chua day du" });
      }

      const orderCode = await createUniqueOrderCode();

      const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:5173";
      
      // PayOS requirements for description: <= 30 chars, alphanumeric & spaces only
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

      console.log("Creating PayOS subscription checkout", {
        orderCode,
        ownerId,
        planCode: plan.code,
        billingCycle: cycle,
        amount
      });
      const payosResponse = await payOS.paymentRequests.create(paymentData);

      if (!payosResponse || !payosResponse.checkoutUrl) {
        return res.status(500).json({ message: "Không tạo được liên kết thanh toán từ PayOS" });
      }

      // 4. Tạo/Cập nhật Subscription dạng PENDING_PAYMENT
      // Tìm subscription dạng PENDING_PAYMENT trước đó của gói này hoặc tạo mới
      const subscription = await Subscription.create({
        ownerId,
        planId: plan._id,
        planCode: plan.code,
        status: SubscriptionStatus.PENDING_PAYMENT,
        billingCycle: cycle,
        amount,
        paymentOrderCode: orderCode,
        payosPaymentLinkId: payosResponse.paymentLinkId
      });

      // 5. Tạo PaymentTransaction PENDING
      await PaymentTransaction.create({
        ownerId,
        planId: plan._id,
        subscriptionId: subscription._id,
        orderCode,
        amount,
        status: PaymentStatus.PENDING,
        paymentLinkId: payosResponse.paymentLinkId,
        checkoutUrl: payosResponse.checkoutUrl,
        qrCode: payosResponse.qrCode,
        payosRawResponse: payosResponse
      });

      res.json({
        checkoutUrl: payosResponse.checkoutUrl,
        qrCode: payosResponse.qrCode,
        paymentLinkId: payosResponse.paymentLinkId,
        orderCode,
        amount,
        status: payosResponse.status
      });
    } catch (error: any) {
      console.error("Lỗi khi tạo checkout subscription:", error);
      res.status(500).json({ message: error.message || "Lỗi hệ thống khi khởi tạo thanh toán" });
    }
  }
);

// GET /api/owner/subscription/payment-status - Kiểm tra và cập nhật trạng thái thanh toán theo orderCode
router.get(
  "/owner/subscription/payment-status",
  requireAuth,
  requireRole(UserRole.RESTAURANT_OWNER as string),
  async (req: AuthRequest, res) => {
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
      const transaction = await PaymentTransaction.findOne({ orderCode: oCode, ownerId });
      if (!transaction) {
        return res.status(404).json({ message: "Không tìm thấy giao dịch thanh toán này" });
      }

      // 2. Gọi PayOS kiểm tra trạng thái thực tế
      if (transaction.status === PaymentStatus.PAID) {
        return res.json({
          status: "PAID",
          message: "Thanh toan da duoc xac nhan va goi da duoc kich hoat."
        });
      }

      if (transaction.status === PaymentStatus.CANCELLED || transaction.status === PaymentStatus.FAILED) {
        return res.json({
          status: transaction.status === PaymentStatus.FAILED ? "FAILED" : "CANCELLED",
          message: "Giao dich da bi huy hoac that bai."
        });
      }

      const payosInfo = await payOS.paymentRequests.get(oCode);
      console.log(`PayOS status for order ${oCode}:`, payosInfo.status);

      // 3. Nếu đã thanh toán thành công (PAID)
      if (payosInfo.status === "PAID") {
        await activatePaidSubscription(transaction, payosInfo);
        return res.json({
          status: "PAID",
          message: "Thanh toan thanh cong va goi da duoc kich hoat!"
        });
      }
      // 4. Nếu bị hủy (CANCELLED)
      if (payosInfo.status === "CANCELLED" || payosInfo.status === "EXPIRED") {
        await cancelPendingPayment(transaction, payosInfo);

        return res.json({
          status: payosInfo.status,
          message: "Giao dịch đã bị hủy bỏ hoặc hết hạn."
        });
      }

      // Ngược lại, trả về trạng thái hiện tại (PENDING)
      res.json({
        status: "PENDING",
        message: "Đang chờ khách hàng thanh toán."
      });
    } catch (error: any) {
      console.error("Lỗi khi kiểm tra trạng thái thanh toán:", error);
      res.status(500).json({ message: error.message || "Lỗi hệ thống khi kiểm tra trạng thái" });
    }
  }
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
