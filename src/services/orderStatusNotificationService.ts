import { OrderStatus } from "../models/Order.js";
import { NotificationPriority, NotificationType } from "../models/Notification.js";

interface OrderStatusNotificationInput {
  restaurantId: string;
  orderId: string;
  tableNumber: string;
  status: OrderStatus;
  updatedByName: string;
  actorUserId?: string;
}

interface SystemNotificationInput {
  title: string;
  message: string;
  type: NotificationType;
  priority: NotificationPriority;
  recipientUserIds: string[];
  restaurantId: string;
  orderId: string;
  actionUrl: string;
}

interface OrderStatusNotificationDependencies {
  schedule: (job: () => Promise<void>) => void;
  findStaffUserIds: (restaurantId: string) => Promise<string[]>;
  resolveOwnerId: (restaurantId: string) => Promise<string | null>;
  createSystemNotification: (input: SystemNotificationInput) => Promise<unknown>;
  logError: (error: unknown) => void;
}

const statusDescriptions: Record<OrderStatus, string> = {
  [OrderStatus.PENDING]: "đang chờ xử lý",
  [OrderStatus.CONFIRMED]: "được xác nhận",
  [OrderStatus.SERVED]: "ra món",
  [OrderStatus.COMPLETED]: "hoàn thành",
  [OrderStatus.CANCELLED]: "bị hủy"
};

export function createOrderStatusNotificationScheduler(
  dependencies: OrderStatusNotificationDependencies
) {
  return (input: OrderStatusNotificationInput) => {
    dependencies.schedule(async () => {
      try {
        const [staffIds, ownerId] = await Promise.all([
          dependencies.findStaffUserIds(input.restaurantId),
          dependencies.resolveOwnerId(input.restaurantId)
        ]);
        const recipientUserIds = [...new Set([...staffIds, ...(ownerId ? [ownerId] : [])])]
          .filter((userId) => userId !== input.actorUserId);

        if (recipientUserIds.length === 0) return;

        const actor = input.updatedByName.trim() || "nhân viên nhà hàng";
        await dependencies.createSystemNotification({
          title: "Đơn hàng cập nhật",
          message: `Đơn hàng bàn ${input.tableNumber} đã ${statusDescriptions[input.status]} bởi ${actor}`,
          type: NotificationType.ORDER,
          priority: NotificationPriority.NORMAL,
          recipientUserIds,
          restaurantId: input.restaurantId,
          orderId: input.orderId,
          actionUrl: "/dashboard?tab=orders"
        });
      } catch (error) {
        dependencies.logError(error);
      }
    });
  };
}
