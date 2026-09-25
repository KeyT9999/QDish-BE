import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Order } from "../models/Order.js";
import { Bill } from "../models/Bill.js";
import { NotificationPriority, NotificationType } from "../models/Notification.js";
import { Restaurant } from "../models/Restaurant.js";
import { User, UserRole } from "../models/User.js";
import { recordCustomerOrder } from "./customerIdentityService.js";
import { sendNewOrderNotification } from "./emailService.js";
import { createSystemNotification } from "./notificationService.js";

const MAX_ATTEMPTS = 8;
const LOCK_DURATION_MS = 2 * 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60_000;
const TASK_NAMES = ["notification", "email", "customerStats"] as const;
type TaskName = typeof TASK_NAMES[number];

type SideEffectDependencies = {
  Order: {
    findOneAndUpdate: (...args: any[]) => any;
    updateOne: (...args: any[]) => Promise<unknown>;
  };
  Bill: { exists: (...args: any[]) => any };
  Restaurant: { findById: (...args: any[]) => any };
  User: { find: (...args: any[]) => any };
  createSystemNotification: typeof createSystemNotification;
  sendNewOrderNotification: typeof sendNewOrderNotification;
  recordCustomerOrder: typeof recordCustomerOrder;
  now: () => Date;
  createToken: () => string;
};

const defaultDependencies: SideEffectDependencies = {
  Order,
  Bill,
  Restaurant,
  User,
  createSystemNotification,
  sendNewOrderNotification,
  recordCustomerOrder,
  now: () => new Date(),
  createToken: randomUUID
};

const resolveQuery = async <T>(query: any, projection?: string): Promise<T> => {
  return await (projection && typeof query?.select === "function" ? query.select(projection) : query) as T;
};

const errorCode = (error: unknown) => {
  const name = error && typeof error === "object" && "name" in error
    ? String((error as { name?: unknown }).name)
    : "SIDE_EFFECT_FAILED";
  return /^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(name) ? name : "SIDE_EFFECT_FAILED";
};

const shouldRun = (status: string | undefined) => status === "pending";

export function createOrderSideEffectsWorker(deps: Partial<SideEffectDependencies> = {}) {
  const dependencies: SideEffectDependencies = { ...defaultDependencies, ...deps };
  return {
    async runOnce(): Promise<boolean> {
      const now = dependencies.now();
      const token = dependencies.createToken();
      const claimQuery = dependencies.Order.findOneAndUpdate(
        {
          $or: [
            {
              "sideEffects.status": { $in: ["pending", "retry"] },
              "sideEffects.nextAttemptAt": { $lte: now }
            },
            {
              "sideEffects.status": "processing",
              "sideEffects.lockUntil": { $lte: now }
            }
          ]
        },
        {
          $set: {
            "sideEffects.status": "processing",
            "sideEffects.lockToken": token,
            "sideEffects.lockUntil": new Date(now.getTime() + LOCK_DURATION_MS)
          }
        },
        { new: true, sort: { createdAt: 1 } }
      );
      const order = await resolveQuery<any>(claimQuery, "+sideEffects");
      if (!order) return false;

      const orderId = order._id.toString();
      const filter = { _id: order._id, "sideEffects.lockToken": token };
      let renewalRunning = false;
      const heartbeat = setInterval(() => {
        if (renewalRunning) return;
        renewalRunning = true;
        void dependencies.Order.updateOne(filter, {
          $set: { "sideEffects.lockUntil": new Date(dependencies.now().getTime() + LOCK_DURATION_MS) }
        }).catch(error => {
          console.error(JSON.stringify({ event: "order_side_effect_lease_renewal_failed", orderId, errorCode: errorCode(error) }));
        }).finally(() => { renewalRunning = false; });
      }, Math.floor(LOCK_DURATION_MS / 3));
      heartbeat.unref();

      try {
      const effects = order.sideEffects;

      if (order.billId) {
        const billQuery = dependencies.Bill.exists({ _id: order.billId, orderIds: order._id });
        const linkedBill = await billQuery;
        if (!linkedBill) {
          const billLinkAttempts = Number(effects.billLinkAttempts || 0) + 1;
          const terminal = billLinkAttempts >= MAX_ATTEMPTS;
          const retryDelay = Math.min(2000 * 2 ** (billLinkAttempts - 1), MAX_RETRY_DELAY_MS);
          const set: Record<string, unknown> = {
            "sideEffects.status": terminal ? "failed" : "retry",
            "sideEffects.billLinkAttempts": billLinkAttempts,
            "sideEffects.lastErrorCode": "BILL_ORDER_LINK_MISSING"
          };
          const unset: Record<string, string> = { "sideEffects.lockToken": "", "sideEffects.lockUntil": "" };
          if (terminal) set["sideEffects.finishedAt"] = dependencies.now();
          else set["sideEffects.nextAttemptAt"] = new Date(now.getTime() + retryDelay);
          await dependencies.Order.updateOne(filter, {
            $set: set,
            $unset: unset
          });
          if (terminal) {
            console.error(JSON.stringify({
              event: "order_side_effect_failed",
              requestId: effects.requestId,
              orderId,
              task: "billLink",
              attempt: billLinkAttempts,
              terminal: true,
              errorCode: "BILL_ORDER_LINK_MISSING"
            }));
          }
          return true;
        }
        if (Number(effects.billLinkAttempts || 0) > 0) {
          await dependencies.Order.updateOne(filter, {
            $set: { "sideEffects.billLinkAttempts": 0 },
            $unset: { "sideEffects.lastErrorCode": "" }
          });
        }
      }

      const saveTask = async (
        task: TaskName,
        status: "completed" | "skipped" | "pending" | "failed",
        attempts: number,
        failureCode?: string
      ) => {
        effects[task].status = status;
        effects[task].attempts = attempts;
        if (failureCode) effects[task].lastErrorCode = failureCode;
        const set: Record<string, unknown> = {
          [`sideEffects.${task}.status`]: status,
          [`sideEffects.${task}.attempts`]: attempts
        };
        if (failureCode) set[`sideEffects.${task}.lastErrorCode`] = failureCode;
        const update: Record<string, unknown> = { $set: set };
        if (!failureCode) update.$unset = { [`sideEffects.${task}.lastErrorCode`]: "" };
        await dependencies.Order.updateOne(filter, update);
      };

      const execute = async (task: TaskName, action: () => Promise<boolean | void>) => {
        const taskState = effects[task];
        if (!shouldRun(taskState?.status)) return;
        const attempts = Number(taskState.attempts || 0);
        const taskStartedAt = performance.now();
        try {
          const shouldSkip = await action();
          await saveTask(task, shouldSkip ? "skipped" : "completed", attempts);
          console.info(JSON.stringify({
            event: "order_side_effect_timing",
            requestId: effects.requestId,
            orderId,
            task,
            status: shouldSkip ? "skipped" : "completed",
            durationMs: Number((performance.now() - taskStartedAt).toFixed(2))
          }));
        } catch (error) {
          const nextAttempts = attempts + 1;
          const terminal = nextAttempts >= MAX_ATTEMPTS;
          const code = errorCode(error);
          await saveTask(task, terminal ? "failed" : "pending", nextAttempts, code);
          console.error(JSON.stringify({
            event: "order_side_effect_failed",
            requestId: effects.requestId,
            orderId,
            task,
            attempt: nextAttempts,
            terminal,
            errorCode: code,
            durationMs: Number((performance.now() - taskStartedAt).toFixed(2))
          }));
        }
      };

      let restaurant: any;
      let restaurantLoaded = false;
      const getRestaurant = async () => {
        if (!restaurantLoaded) {
          restaurantLoaded = true;
          restaurant = await resolveQuery<any>(dependencies.Restaurant.findById(order.restaurantId), "name ownerName email");
        }
        return restaurant;
      };

      await execute("notification", async () => {
        const staff = await resolveQuery<any[]>(dependencies.User.find({
          restaurantId: order.restaurantId,
          role: { $in: [UserRole.RESTAURANT_ADMIN, UserRole.STAFF] },
          isActive: true
        }), "_id");
        if (!staff?.length) return true;
        const itemCount = order.items.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0);
        await dependencies.createSystemNotification({
          title: "Đơn hàng mới",
          message: `Bàn ${order.tableNumber} vừa đặt ${itemCount} món - ${order.totalAmount.toLocaleString("vi-VN")}đ`,
          type: NotificationType.ORDER,
          priority: NotificationPriority.URGENT,
          recipientUserIds: staff.map(user => user._id),
          restaurantId: order.restaurantId,
          orderId,
          idempotencyKey: `order-notification:${orderId}`,
          actionUrl: "/dashboard?tab=orders"
        });
      });

      await execute("email", async () => {
        const restaurantRecord = await getRestaurant();
        if (!restaurantRecord?.email) return true;
        await dependencies.sendNewOrderNotification({
          to: restaurantRecord.email,
          restaurantName: restaurantRecord.name,
          ownerName: restaurantRecord.ownerName,
          orderId,
          messageId: `<qdish-order-${orderId}@notifications.qdish>`,
          tableNumber: order.tableNumber,
          items: order.items.map((item: { name: string; price: number; quantity: number }) => ({
            name: item.name,
            price: item.price,
            quantity: item.quantity
          })),
          totalAmount: order.totalAmount,
          note: order.note,
          orderTime: order.createdAt || now
        });
      });

      await execute("customerStats", async () => {
        const customerId = effects.customerStats.customerId;
        if (!customerId) return true;
        await dependencies.recordCustomerOrder(
          customerId,
          order.totalAmount,
          Boolean(effects.customerStats.sessionWasLinked),
          orderId
        );
      });

      const taskStatuses = TASK_NAMES.map(task => effects[task].status);
      const hasPending = taskStatuses.includes("pending");
      const hasFailed = taskStatuses.includes("failed");
      const nextStatus = hasPending ? "retry" : hasFailed ? "failed" : "completed";
      const nextAttempt = Math.max(...TASK_NAMES.map(task => Number(effects[task].attempts || 0)));
      const retryDelay = Math.min(1000 * 2 ** Math.max(0, nextAttempt - 1), MAX_RETRY_DELAY_MS);
      const finalSet: Record<string, unknown> = { "sideEffects.status": nextStatus };
      const finalUnset: Record<string, string> = {
        "sideEffects.lockToken": "",
        "sideEffects.lockUntil": ""
      };
      if (nextStatus === "retry") {
        finalSet["sideEffects.nextAttemptAt"] = new Date(dependencies.now().getTime() + retryDelay);
        finalUnset["sideEffects.finishedAt"] = "";
      } else {
        finalSet["sideEffects.finishedAt"] = dependencies.now();
        finalUnset["sideEffects.nextAttemptAt"] = "";
      }
      const finalUpdate = { $set: finalSet, $unset: finalUnset };
      await dependencies.Order.updateOne(filter, finalUpdate);
      return true;
      } finally {
        clearInterval(heartbeat);
      }
    }
  };
}

const worker = createOrderSideEffectsWorker();
let workerRunning = false;

export function initOrderSideEffectsWorker() {
  const runBatch = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      for (let index = 0; index < 10; index += 1) {
        if (!(await worker.runOnce())) break;
      }
    } catch (error) {
      console.error(JSON.stringify({ event: "order_side_effect_worker_error", errorCode: errorCode(error) }));
    } finally {
      workerRunning = false;
    }
  };

  const interval = setInterval(() => { void runBatch(); }, 2000);
  interval.unref();
  void runBatch();
  return () => clearInterval(interval);
}
