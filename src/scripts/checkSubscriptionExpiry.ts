/**
 * Subscription Lifecycle Engine
 * 
 * Kiểm tra subscription sắp hết hạn và đã hết hạn,
 * gửi notification theo mốc thời gian (7 ngày, 3 ngày, 1 ngày, đã hết hạn),
 * tự động downgrade về FREE khi hết hạn.
 * 
 * Chạy thủ công: tsx src/scripts/checkSubscriptionExpiry.ts
 * Hoặc tự động qua cron job.
 */

import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Plan } from "../models/Plan.js";
import { Subscription, SubscriptionStatus, BillingCycle } from "../models/Subscription.js";
import { NotificationType, NotificationPriority } from "../models/Notification.js";
import { createSystemNotification } from "../services/notificationService.js";
import { calculateDaysRemaining } from "../services/subscriptionService.js";

// Warning levels in order of severity
const WARNING_LEVELS = ["none", "7days", "3days", "1day", "expired"] as const;
type WarningLevel = typeof WARNING_LEVELS[number];

function getWarningLevelIndex(level: string): number {
  return WARNING_LEVELS.indexOf(level as WarningLevel);
}

function shouldSendWarning(currentLevel: WarningLevel, lastSentLevel: string | undefined): boolean {
  const currentIdx = getWarningLevelIndex(currentLevel);
  const lastIdx = getWarningLevelIndex(lastSentLevel || "none");
  // Only send if this level is more severe than what was already sent
  return currentIdx > lastIdx;
}

/**
 * Kiểm tra subscription sắp hết hạn và gửi cảnh báo theo mốc thời gian.
 */
async function checkExpiringSubscriptions(): Promise<{ warned: number; downgraded: number }> {
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  let warned = 0;
  let downgraded = 0;

  // 1. Find all ACTIVE paid subscriptions expiring within 7 days (or already expired)
  const subscriptions = await Subscription.find({
    status: SubscriptionStatus.ACTIVE,
    planCode: { $ne: "FREE" },
    expiresAt: { $lte: sevenDaysLater }
  });

  console.log(`[SubscriptionEngine] Found ${subscriptions.length} subscriptions to process`);

  for (const sub of subscriptions) {
    const daysLeft = calculateDaysRemaining(sub.expiresAt, sub.planCode);

    // Determine warning level
    let warningLevel: WarningLevel;
    if (daysLeft <= 0) {
      warningLevel = "expired";
    } else if (daysLeft <= 1) {
      warningLevel = "1day";
    } else if (daysLeft <= 3) {
      warningLevel = "3days";
    } else if (daysLeft <= 7) {
      warningLevel = "7days";
    } else {
      continue; // Shouldn't happen but safety check
    }

    // Check dedup — only send if more severe than last sent
    if (!shouldSendWarning(warningLevel, sub.lastWarningLevel)) {
      continue;
    }

    // Handle expired subscriptions → auto downgrade to FREE
    if (warningLevel === "expired") {
      await autoDowngradeToFree(sub);
      downgraded++;
    }

    // Send notification
    try {
      const notifConfig = getNotificationConfig(warningLevel, sub.planCode, daysLeft);
      await createSystemNotification({
        title: notifConfig.title,
        message: notifConfig.message,
        type: NotificationType.SUBSCRIPTION,
        priority: notifConfig.priority,
        recipientUserIds: [sub.ownerId],
        ownerId: sub.ownerId,
        subscriptionId: sub._id as any,
        actionUrl: "/owner?tab=billing"
      });

      // Update lastWarningLevel for dedup
      sub.lastWarningLevel = warningLevel;
      await sub.save();

      warned++;
      console.log(`  [${warningLevel}] Owner ${sub.ownerId} — plan ${sub.planCode} — ${daysLeft} days left`);
    } catch (err) {
      console.error(`  Failed to notify owner ${sub.ownerId}:`, err);
    }
  }

  return { warned, downgraded };
}

/**
 * Tự động downgrade subscription về FREE khi hết hạn.
 */
async function autoDowngradeToFree(sub: any): Promise<void> {
  // 1. Mark current subscription as EXPIRED
  sub.status = SubscriptionStatus.EXPIRED;
  sub.lastWarningLevel = "expired";
  await sub.save();

  // 2. Create new FREE ACTIVE subscription for the owner
  const freePlan = await Plan.findOne({ code: "FREE" });
  if (!freePlan) {
    console.error(`  Cannot find FREE plan to downgrade owner ${sub.ownerId}`);
    return;
  }

  // Check if there's already an active FREE subscription (edge case)
  const existingFree = await Subscription.findOne({
    ownerId: sub.ownerId,
    status: SubscriptionStatus.ACTIVE,
    planCode: "FREE"
  });

  if (!existingFree) {
    await Subscription.create({
      ownerId: sub.ownerId,
      planId: freePlan._id,
      planCode: "FREE",
      status: SubscriptionStatus.ACTIVE,
      billingCycle: BillingCycle.MONTHLY,
      amount: 0,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000), // 100 years
      lastWarningLevel: "none"
    });
  }

  console.log(`  AUTO-DOWNGRADE: Owner ${sub.ownerId} — ${sub.planCode} → FREE`);
}

/**
 * Lấy nội dung notification theo mức cảnh báo.
 */
function getNotificationConfig(level: WarningLevel, planCode: string, daysLeft: number): {
  title: string;
  message: string;
  priority: NotificationPriority;
} {
  switch (level) {
    case "7days":
      return {
        title: "Gói dịch vụ sắp hết hạn",
        message: `Gói ${planCode} sẽ hết hạn sau ${daysLeft} ngày. Vui lòng gia hạn để tránh gián đoạn dịch vụ.`,
        priority: NotificationPriority.NORMAL
      };
    case "3days":
      return {
        title: "Gói dịch vụ sắp hết hạn",
        message: `Gói ${planCode} sắp hết hạn (còn ${daysLeft} ngày). Các tính năng cao cấp sẽ bị khóa sau khi hết hạn.`,
        priority: NotificationPriority.HIGH
      };
    case "1day":
      return {
        title: "⚠️ Gói dịch vụ sẽ hết hạn trong 24 giờ",
        message: `Gói ${planCode} sẽ bị hạ xuống FREE sau 24 giờ nữa. Hãy gia hạn ngay để giữ tất cả tính năng cao cấp.`,
        priority: NotificationPriority.URGENT
      };
    case "expired":
      return {
        title: "Gói dịch vụ đã hết hạn",
        message: `Gói ${planCode} đã hết hạn. Hệ thống đã tự động chuyển tài khoản về gói FREE. Các tính năng cao cấp đã bị khóa.`,
        priority: NotificationPriority.URGENT
      };
    default:
      return {
        title: "Thông báo gói dịch vụ",
        message: `Gói ${planCode} có cập nhật mới.`,
        priority: NotificationPriority.LOW
      };
  }
}

// Run standalone
const isDirectRun = process.argv[1]?.includes("checkSubscriptionExpiry");
if (isDirectRun) {
  connectDB()
    .then(() => checkExpiringSubscriptions())
    .then(({ warned, downgraded }) => {
      console.log(`✅ Subscription check complete: ${warned} warned, ${downgraded} downgraded`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Error:", err);
      process.exit(1);
    });
}

export { checkExpiringSubscriptions, autoDowngradeToFree };
