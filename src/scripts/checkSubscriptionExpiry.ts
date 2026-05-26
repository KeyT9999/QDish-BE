/**
 * Script: Check subscription expiry
 * 
 * Tìm subscription sắp hết hạn (3 ngày) và đã hết hạn,
 * gửi notification tự động cho Owner.
 * 
 * Chạy: tsx src/scripts/checkSubscriptionExpiry.ts
 * Hoặc gọi qua API endpoint.
 */

import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Subscription, SubscriptionStatus } from "../models/Subscription.js";
import { NotificationType, NotificationPriority } from "../models/Notification.js";
import { createSystemNotification } from "../services/notificationService.js";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

async function checkExpiringSubscriptions() {
  const now = new Date();
  const threeDaysLater = new Date(now.getTime() + THREE_DAYS_MS);

  // 1. Find subscriptions expiring within 3 days (still ACTIVE)
  const expiringSoon = await Subscription.find({
    status: SubscriptionStatus.ACTIVE,
    expiresAt: { $gte: now, $lte: threeDaysLater },
    planCode: { $ne: "FREE" }
  });

  console.log(`Found ${expiringSoon.length} subscriptions expiring within 3 days`);

  for (const sub of expiringSoon) {
    const daysLeft = Math.ceil(((sub.expiresAt?.getTime() || 0) - now.getTime()) / (24 * 60 * 60 * 1000));
    try {
      await createSystemNotification({
        title: "Gói dịch vụ sắp hết hạn",
        message: `Gói ${sub.planCode} của bạn còn ${daysLeft} ngày nữa hết hạn. Vui lòng gia hạn để tránh gián đoạn dịch vụ.`,
        type: NotificationType.SUBSCRIPTION,
        priority: NotificationPriority.HIGH,
        recipientUserIds: [sub.ownerId],
        ownerId: sub.ownerId,
        subscriptionId: sub._id as any,
        actionUrl: "/owner?tab=billing"
      });
      console.log(`  Notified owner ${sub.ownerId} - plan ${sub.planCode} expires in ${daysLeft} days`);
    } catch (err) {
      console.error(`  Failed to notify owner ${sub.ownerId}:`, err);
    }
  }

  // 2. Find expired subscriptions (still marked ACTIVE but past expiresAt)
  const expired = await Subscription.find({
    status: SubscriptionStatus.ACTIVE,
    expiresAt: { $lt: now },
    planCode: { $ne: "FREE" }
  });

  console.log(`Found ${expired.length} expired subscriptions`);

  for (const sub of expired) {
    // Mark as expired
    sub.status = SubscriptionStatus.EXPIRED;
    await sub.save();

    try {
      await createSystemNotification({
        title: "Gói dịch vụ đã hết hạn",
        message: `Gói ${sub.planCode} đã hết hạn. Vui lòng gia hạn để tiếp tục sử dụng đầy đủ tính năng.`,
        type: NotificationType.SUBSCRIPTION,
        priority: NotificationPriority.URGENT,
        recipientUserIds: [sub.ownerId],
        ownerId: sub.ownerId,
        subscriptionId: sub._id as any,
        actionUrl: "/owner?tab=billing"
      });
      console.log(`  Notified owner ${sub.ownerId} - plan ${sub.planCode} EXPIRED`);
    } catch (err) {
      console.error(`  Failed to notify owner ${sub.ownerId}:`, err);
    }
  }
}

// Run standalone
const isDirectRun = process.argv[1]?.includes("checkSubscriptionExpiry");
if (isDirectRun) {
  connectDB()
    .then(() => checkExpiringSubscriptions())
    .then(() => {
      console.log("✅ Subscription expiry check complete");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Error:", err);
      process.exit(1);
    });
}

export { checkExpiringSubscriptions };
