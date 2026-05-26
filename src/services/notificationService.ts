import mongoose, { Types } from "mongoose";
import {
  Notification,
  NotificationType,
  NotificationPriority,
  NotificationSource,
  SenderRole,
  TargetType
} from "../models/Notification.js";
import { NotificationRecipient } from "../models/NotificationRecipient.js";
import { User, UserRole } from "../models/User.js";
import { Restaurant } from "../models/Restaurant.js";
import { emitNotification, emitUnreadCount } from "../realtime/socket.js";

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface ResolvedRecipient {
  userId: Types.ObjectId;
  role: string;
  restaurantId?: Types.ObjectId;
  ownerId?: Types.ObjectId;
}

interface CreateNotificationParams {
  title: string;
  message: string;
  type: NotificationType;
  priority?: NotificationPriority;
  source: NotificationSource;
  senderId?: string;
  senderRole: SenderRole;
  targetType: TargetType;
  targetIds?: string[];
  restaurantId?: string;
  ownerId?: string;
  orderId?: string;
  subscriptionId?: string;
  paymentTransactionId?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

interface CreateSystemNotificationParams {
  title: string;
  message: string;
  type: NotificationType;
  priority: NotificationPriority;
  recipientUserIds: (string | Types.ObjectId)[];
  restaurantId?: string | Types.ObjectId;
  ownerId?: string | Types.ObjectId;
  orderId?: string | Types.ObjectId;
  subscriptionId?: string | Types.ObjectId;
  paymentTransactionId?: string | Types.ObjectId;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

// ──────────────────────────────────────────
// Target Resolver
// ──────────────────────────────────────────

export async function resolveTargets(
  senderRole: string,
  senderUserId: string | undefined,
  targetType: TargetType,
  targetIds?: string[],
  ownerIdParam?: string,
  restaurantIdParam?: string
): Promise<ResolvedRecipient[]> {
  const recipients: ResolvedRecipient[] = [];

  switch (targetType) {
    case TargetType.ALL_OWNERS: {
      if (senderRole !== UserRole.SUPER_ADMIN) throw new Error("Không có quyền gửi tới tất cả chủ nhà hàng");
      const owners = await User.find({ role: UserRole.RESTAURANT_OWNER, isActive: true }).select("_id role");
      for (const owner of owners) {
        recipients.push({ userId: owner._id as Types.ObjectId, role: owner.role });
      }
      break;
    }

    case TargetType.OWNER: {
      if (senderRole !== UserRole.SUPER_ADMIN) throw new Error("Không có quyền gửi tới chủ nhà hàng cụ thể");
      if (!targetIds?.length) throw new Error("Thiếu targetIds cho OWNER");
      const owner = await User.findOne({ _id: targetIds[0], role: UserRole.RESTAURANT_OWNER });
      if (!owner) throw new Error("Không tìm thấy chủ nhà hàng");
      recipients.push({ userId: owner._id as Types.ObjectId, role: owner.role });
      break;
    }

    case TargetType.ALL_RESTAURANTS: {
      if (senderRole !== UserRole.SUPER_ADMIN) throw new Error("Không có quyền gửi tới tất cả nhà hàng");
      const admins = await User.find({ role: UserRole.RESTAURANT_ADMIN, isActive: true }).select("_id role restaurantId");
      for (const admin of admins) {
        recipients.push({
          userId: admin._id as Types.ObjectId,
          role: admin.role,
          restaurantId: admin.restaurantId
        });
      }
      break;
    }

    case TargetType.RESTAURANT: {
      const restaurantId = targetIds?.[0] || restaurantIdParam;
      if (!restaurantId) throw new Error("Thiếu restaurantId cho RESTAURANT");

      // Owner chỉ gửi tới nhà hàng mình sở hữu
      if (senderRole === UserRole.RESTAURANT_OWNER) {
        const restaurant = await Restaurant.findById(restaurantId);
        if (!restaurant || restaurant.ownerId?.toString() !== senderUserId) {
          throw new Error("Bạn không có quyền gửi thông báo tới nhà hàng này");
        }
      } else if (senderRole !== UserRole.SUPER_ADMIN) {
        throw new Error("Không có quyền gửi tới nhà hàng");
      }

      const users = await User.find({
        restaurantId: new Types.ObjectId(restaurantId),
        role: { $in: [UserRole.RESTAURANT_ADMIN, UserRole.STAFF] },
        isActive: true
      }).select("_id role restaurantId");

      for (const u of users) {
        recipients.push({
          userId: u._id as Types.ObjectId,
          role: u.role,
          restaurantId: u.restaurantId
        });
      }
      break;
    }

    case TargetType.OWNER_RESTAURANTS: {
      const ownerId = ownerIdParam || senderUserId;
      if (!ownerId) throw new Error("Thiếu ownerId cho OWNER_RESTAURANTS");

      if (senderRole === UserRole.RESTAURANT_OWNER && senderUserId !== ownerId) {
        throw new Error("Không có quyền gửi tới nhà hàng của chủ khác");
      }
      if (senderRole !== UserRole.SUPER_ADMIN && senderRole !== UserRole.RESTAURANT_OWNER) {
        throw new Error("Không có quyền gửi tới nhà hàng");
      }

      const restaurants = await Restaurant.find({ ownerId: new Types.ObjectId(ownerId) }).select("_id");
      const restIds = restaurants.map(r => r._id);
      const admins = await User.find({
        restaurantId: { $in: restIds },
        role: UserRole.RESTAURANT_ADMIN,
        isActive: true
      }).select("_id role restaurantId");

      for (const admin of admins) {
        recipients.push({
          userId: admin._id as Types.ObjectId,
          role: admin.role,
          restaurantId: admin.restaurantId,
          ownerId: new Types.ObjectId(ownerId)
        });
      }
      break;
    }

    case TargetType.OWNER_STAFF: {
      const ownerId = ownerIdParam || senderUserId;
      if (!ownerId) throw new Error("Thiếu ownerId cho OWNER_STAFF");

      if (senderRole === UserRole.RESTAURANT_OWNER && senderUserId !== ownerId) {
        throw new Error("Không có quyền gửi tới nhân viên của chủ khác");
      }
      if (senderRole !== UserRole.SUPER_ADMIN && senderRole !== UserRole.RESTAURANT_OWNER) {
        throw new Error("Không có quyền gửi tới nhân viên");
      }

      const restaurants = await Restaurant.find({ ownerId: new Types.ObjectId(ownerId) }).select("_id");
      const restIds = restaurants.map(r => r._id);
      const staffUsers = await User.find({
        restaurantId: { $in: restIds },
        role: UserRole.STAFF,
        isActive: true
      }).select("_id role restaurantId");

      for (const s of staffUsers) {
        recipients.push({
          userId: s._id as Types.ObjectId,
          role: s.role,
          restaurantId: s.restaurantId,
          ownerId: new Types.ObjectId(ownerId)
        });
      }
      break;
    }

    case TargetType.RESTAURANT_STAFF: {
      const restaurantId = targetIds?.[0] || restaurantIdParam;
      if (!restaurantId) throw new Error("Thiếu restaurantId cho RESTAURANT_STAFF");

      if (senderRole === UserRole.RESTAURANT_OWNER) {
        const restaurant = await Restaurant.findById(restaurantId);
        if (!restaurant || restaurant.ownerId?.toString() !== senderUserId) {
          throw new Error("Bạn không có quyền gửi thông báo tới nhân viên nhà hàng này");
        }
      } else if (senderRole !== UserRole.SUPER_ADMIN) {
        throw new Error("Không có quyền gửi tới nhân viên nhà hàng");
      }

      const staffUsers = await User.find({
        restaurantId: new Types.ObjectId(restaurantId),
        role: UserRole.STAFF,
        isActive: true
      }).select("_id role restaurantId");

      for (const s of staffUsers) {
        recipients.push({
          userId: s._id as Types.ObjectId,
          role: s.role,
          restaurantId: s.restaurantId
        });
      }
      break;
    }

    case TargetType.USER: {
      if (senderRole !== UserRole.SUPER_ADMIN) throw new Error("Không có quyền gửi tới user cụ thể");
      if (!targetIds?.length) throw new Error("Thiếu targetIds cho USER");
      const user = await User.findById(targetIds[0]);
      if (!user) throw new Error("Không tìm thấy user");
      recipients.push({
        userId: user._id as Types.ObjectId,
        role: user.role,
        restaurantId: user.restaurantId
      });
      break;
    }

    case TargetType.ROLE: {
      if (senderRole !== UserRole.SUPER_ADMIN) throw new Error("Không có quyền gửi theo role");
      if (!targetIds?.length) throw new Error("Thiếu targetIds (role name) cho ROLE");
      const users = await User.find({ role: targetIds[0], isActive: true }).select("_id role restaurantId");
      for (const u of users) {
        recipients.push({
          userId: u._id as Types.ObjectId,
          role: u.role,
          restaurantId: u.restaurantId
        });
      }
      break;
    }

    default:
      throw new Error(`TargetType không hợp lệ: ${targetType}`);
  }

  return recipients;
}

// ──────────────────────────────────────────
// Create Notification (Manual)
// ──────────────────────────────────────────

export async function createNotification(params: CreateNotificationParams) {
  const {
    title,
    message,
    type,
    priority = NotificationPriority.NORMAL,
    source,
    senderId,
    senderRole,
    targetType,
    targetIds,
    restaurantId,
    ownerId,
    orderId,
    subscriptionId,
    paymentTransactionId,
    actionUrl,
    metadata
  } = params;

  // 1. Resolve recipients
  const recipients = await resolveTargets(
    senderRole,
    senderId,
    targetType,
    targetIds,
    ownerId,
    restaurantId
  );

  if (recipients.length === 0) {
    throw new Error("Không tìm thấy người nhận nào");
  }

  // 2. Create notification record
  const notification = await Notification.create({
    title,
    message,
    type,
    priority,
    source,
    senderId: senderId ? new Types.ObjectId(senderId) : undefined,
    senderRole,
    targetType,
    targetIds: targetIds?.map(id => new Types.ObjectId(id)) || [],
    restaurantId: restaurantId ? new Types.ObjectId(restaurantId) : undefined,
    ownerId: ownerId ? new Types.ObjectId(ownerId) : undefined,
    orderId: orderId ? new Types.ObjectId(orderId) : undefined,
    subscriptionId: subscriptionId ? new Types.ObjectId(subscriptionId) : undefined,
    paymentTransactionId: paymentTransactionId ? new Types.ObjectId(paymentTransactionId) : undefined,
    actionUrl,
    metadata
  });

  // 3. Create recipient records (bulk insert, skip duplicates)
  const recipientDocs = recipients.map(r => ({
    notificationId: notification._id,
    recipientUserId: r.userId,
    recipientRole: r.role,
    ownerId: r.ownerId,
    restaurantId: r.restaurantId,
    isRead: false,
    isArchived: false,
    deliveredAt: new Date()
  }));

  await NotificationRecipient.insertMany(recipientDocs, { ordered: false }).catch(err => {
    // Ignore duplicate key errors (code 11000)
    if (err.code !== 11000 && !err.writeErrors?.every((e: any) => e.err?.code === 11000)) {
      throw err;
    }
  });

  // 4. Emit socket events to each recipient
  const populated = await Notification.findById(notification._id)
    .populate("senderId", "username fullName name role restaurantId")
    .lean();

  let restaurantName: string | undefined = undefined;
  if (populated?.restaurantId) {
    const rest = await Restaurant.findById(populated.restaurantId).select("name").lean();
    if (rest) restaurantName = rest.name;
  }
  if (!restaurantName && populated?.senderId) {
    const senderUser = populated.senderId as any;
    if (populated.senderRole === SenderRole.RESTAURANT_OWNER) {
      const rest = await Restaurant.findOne({ ownerId: senderUser._id }).select("name").lean();
      if (rest) restaurantName = rest.name;
    }
    if (!restaurantName && senderUser.restaurantId) {
      const rest = await Restaurant.findById(senderUser.restaurantId).select("name").lean();
      if (rest) restaurantName = rest.name;
    }
  }

  let senderName = "Hệ thống QDish";
  if (populated?.senderId) {
    const senderUser = populated.senderId as any;
    const sRole = populated.senderRole as string;
    if (sRole === "SUPER_ADMIN") {
      senderName = senderUser.fullName || senderUser.username || "Super Admin";
    } else if (sRole === "RESTAURANT_OWNER") {
      senderName = senderUser.fullName || senderUser.username || "Chủ nhà hàng";
    } else if (sRole === "RESTAURANT_ADMIN") {
      senderName = senderUser.name || senderUser.fullName || senderUser.username || "Quản lý nhà hàng";
    } else if (sRole === "STAFF") {
      senderName = senderUser.name || senderUser.fullName || senderUser.username || "Nhân viên";
    }
  }

  const notificationPayload = {
    id: notification._id?.toString(),
    title: notification.title,
    message: notification.message,
    type: notification.type,
    priority: notification.priority,
    actionUrl: notification.actionUrl,
    senderRole: notification.senderRole,
    senderId: notification.senderId?.toString(),
    sender: populated?.senderId ? {
      id: (populated.senderId as any)._id?.toString(),
      name: senderName
    } : undefined,
    restaurant: restaurantName ? {
      name: restaurantName
    } : undefined,
    source: notification.source,
    metadata: notification.metadata,
    createdAt: notification.createdAt?.toISOString()
  };

  for (const r of recipients) {
    const userId = r.userId.toString();
    emitNotification(userId, notificationPayload);

    // Compute unread count for this user
    const unreadCount = await NotificationRecipient.countDocuments({
      recipientUserId: r.userId,
      isRead: false,
      isArchived: false
    });
    emitUnreadCount(userId, unreadCount);
  }

  return { notification, recipientCount: recipients.length };
}

// ──────────────────────────────────────────
// Create System Notification (Auto)
// ──────────────────────────────────────────

export async function createSystemNotification(params: CreateSystemNotificationParams) {
  const {
    title,
    message,
    type,
    priority,
    recipientUserIds,
    restaurantId,
    ownerId,
    orderId,
    subscriptionId,
    paymentTransactionId,
    actionUrl,
    metadata
  } = params;

  if (!recipientUserIds.length) return null;

  // Create notification record
  const notification = await Notification.create({
    title,
    message,
    type,
    priority,
    source: NotificationSource.AUTO,
    senderRole: SenderRole.SYSTEM,
    targetType: TargetType.USER,
    targetIds: recipientUserIds.map(id =>
      typeof id === "string" ? new Types.ObjectId(id) : id
    ),
    restaurantId: restaurantId
      ? typeof restaurantId === "string" ? new Types.ObjectId(restaurantId) : restaurantId
      : undefined,
    ownerId: ownerId
      ? typeof ownerId === "string" ? new Types.ObjectId(ownerId) : ownerId
      : undefined,
    orderId: orderId
      ? typeof orderId === "string" ? new Types.ObjectId(orderId) : orderId
      : undefined,
    subscriptionId: subscriptionId
      ? typeof subscriptionId === "string" ? new Types.ObjectId(subscriptionId) : subscriptionId
      : undefined,
    paymentTransactionId: paymentTransactionId
      ? typeof paymentTransactionId === "string" ? new Types.ObjectId(paymentTransactionId) : paymentTransactionId
      : undefined,
    actionUrl,
    metadata
  });

  // Fetch user roles for recipients
  const users = await User.find({
    _id: { $in: recipientUserIds.map(id => typeof id === "string" ? new Types.ObjectId(id) : id) }
  }).select("_id role restaurantId");

  const recipientDocs = users.map(u => ({
    notificationId: notification._id,
    recipientUserId: u._id,
    recipientRole: u.role,
    restaurantId: u.restaurantId,
    isRead: false,
    isArchived: false,
    deliveredAt: new Date()
  }));

  if (recipientDocs.length > 0) {
    await NotificationRecipient.insertMany(recipientDocs, { ordered: false }).catch(err => {
      if (err.code !== 11000 && !err.writeErrors?.every((e: any) => e.err?.code === 11000)) {
        throw err;
      }
    });
  }

  // Emit socket events
  let restaurantName: string | undefined = undefined;
  if (notification.restaurantId) {
    const rest = await Restaurant.findById(notification.restaurantId).select("name").lean();
    if (rest) restaurantName = rest.name;
  }

  const notificationPayload = {
    id: notification._id?.toString(),
    title: notification.title,
    message: notification.message,
    type: notification.type,
    priority: notification.priority,
    actionUrl: notification.actionUrl,
    senderRole: notification.senderRole,
    senderId: notification.senderId?.toString(),
    sender: undefined,
    restaurant: restaurantName ? {
      name: restaurantName
    } : undefined,
    source: notification.source,
    metadata: notification.metadata,
    createdAt: notification.createdAt?.toISOString()
  };

  for (const u of users) {
    const userId = (u._id as Types.ObjectId).toString();
    emitNotification(userId, notificationPayload);

    const unreadCount = await NotificationRecipient.countDocuments({
      recipientUserId: u._id,
      isRead: false,
      isArchived: false
    });
    emitUnreadCount(userId, unreadCount);
  }

  return { notification, recipientCount: users.length };
}
