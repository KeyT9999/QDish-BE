/**
 * Subscription Cron Job
 * 
 * Chạy định kỳ mỗi giờ để kiểm tra và xử lý:
 * - Subscription sắp hết hạn (7d, 3d, 1d) → gửi cảnh báo
 * - Subscription đã hết hạn → tự động downgrade về FREE
 */

import cron from "node-cron";
import { checkExpiringSubscriptions } from "../scripts/checkSubscriptionExpiry.js";

let isRunning = false;

async function runSubscriptionCheck() {
  if (isRunning) {
    console.log("[SubscriptionCron] Previous check still running, skipping...");
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    console.log(`[SubscriptionCron] Starting subscription lifecycle check at ${new Date().toISOString()}`);
    const result = await checkExpiringSubscriptions();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[SubscriptionCron] Completed in ${duration}s — ${result.warned} warned, ${result.downgraded} downgraded`);
  } catch (error) {
    console.error("[SubscriptionCron] Error during subscription check:", error);
  } finally {
    isRunning = false;
  }
}

/**
 * Khởi tạo cron job kiểm tra subscription.
 * Chạy mỗi giờ vào phút 0 (0 * * * *).
 */
export function initSubscriptionCronJob() {
  // Schedule: every hour at minute 0
  const task = cron.schedule("0 * * * *", () => {
    runSubscriptionCheck();
  });

  console.log("📅 Subscription cron job initialized — runs every hour (0 * * * *)");

  // Also run once on startup after a small delay to catch any missed expiries
  setTimeout(() => {
    console.log("[SubscriptionCron] Running initial check on startup...");
    runSubscriptionCheck();
  }, 10000); // 10 second delay after server start

  return task;
}
