import { Router } from "express";
import mongoose from "mongoose";
import { AuthRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { UserRole } from "../models/User.js";
import { Notification, NotificationType, NotificationPriority, NotificationSource, SenderRole, TargetType } from "../models/Notification.js";
import { NotificationRecipient } from "../models/NotificationRecipient.js";
import { createNotification } from "../services/notificationService.js";

const router = Router();

const VALID_TYPES = Object.values(NotificationType);
const VALID_PRIORITIES = Object.values(NotificationPriority);
const VALID_TARGET_TYPES = Object.values(TargetType);

// Allowed target types for Owner
const OWNER_ALLOWED_TARGETS: TargetType[] = [
  TargetType.OWNER_RESTAURANTS,
  TargetType.RESTAURANT,
  TargetType.OWNER_STAFF,
  TargetType.RESTAURANT_STAFF
];

// ──────────────────────────────────────────
// 1. Super Admin tạo notification
// POST /api/admin/notifications
// ──────────────────────────────────────────
router.post(
  "/admin/notifications",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req: AuthRequest, res) => {
    try {
      const { title, message, type, priority, targetType, targetIds, restaurantId, ownerId, actionUrl, metadata } = req.body as {
        title?: string;
        message?: string;
        type?: string;
        priority?: string;
        targetType?: string;
        targetIds?: string[];
        restaurantId?: string;
        ownerId?: string;
        actionUrl?: string;
        metadata?: Record<string, unknown>;
      };

      // Validation
      if (!title?.trim()) return res.status(400).json({ message: "Thiếu tiêu đề thông báo" });
      if (!message?.trim()) return res.status(400).json({ message: "Thiếu nội dung thông báo" });
      if (title.trim().length > 200) return res.status(400).json({ message: "Tiêu đề tối đa 200 ký tự" });
      if (message.trim().length > 2000) return res.status(400).json({ message: "Nội dung tối đa 2000 ký tự" });
      if (!type || !VALID_TYPES.includes(type as NotificationType)) {
        return res.status(400).json({ message: "Loại thông báo không hợp lệ" });
      }
      if (priority && !VALID_PRIORITIES.includes(priority as NotificationPriority)) {
        return res.status(400).json({ message: "Mức ưu tiên không hợp lệ" });
      }
      if (!targetType || !VALID_TARGET_TYPES.includes(targetType as TargetType)) {
        return res.status(400).json({ message: "Loại đích gửi không hợp lệ" });
      }

      const result = await createNotification({
        title: title.trim(),
        message: message.trim(),
        type: type as NotificationType,
        priority: (priority as NotificationPriority) || NotificationPriority.NORMAL,
        source: NotificationSource.MANUAL,
        senderId: req.auth!.sub,
        senderRole: SenderRole.SUPER_ADMIN,
        targetType: targetType as TargetType,
        targetIds,
        restaurantId,
        ownerId,
        actionUrl,
        metadata
      });

      res.status(201).json({
        message: "Đã gửi thông báo thành công",
        notification: result.notification,
        recipientCount: result.recipientCount
      });
    } catch (error: any) {
      console.error("Lỗi khi gửi thông báo (admin):", error);
      res.status(400).json({ message: error.message || "Không thể gửi thông báo" });
    }
  }
);

// ──────────────────────────────────────────
// 2. Owner tạo notification
// POST /api/owner/notifications
// ──────────────────────────────────────────
router.post(
  "/owner/notifications",
  requireAuth,
  requireRole(UserRole.RESTAURANT_OWNER as string),
  async (req: AuthRequest, res) => {
    try {
      const { title, message, type, priority, targetType, targetIds, restaurantId, actionUrl, metadata } = req.body as {
        title?: string;
        message?: string;
        type?: string;
        priority?: string;
        targetType?: string;
        targetIds?: string[];
        restaurantId?: string;
        actionUrl?: string;
        metadata?: Record<string, unknown>;
      };

      const ownerId = req.auth!.sub;

      // Validation
      if (!title?.trim()) return res.status(400).json({ message: "Thiếu tiêu đề thông báo" });
      if (!message?.trim()) return res.status(400).json({ message: "Thiếu nội dung thông báo" });
      if (title.trim().length > 200) return res.status(400).json({ message: "Tiêu đề tối đa 200 ký tự" });
      if (message.trim().length > 2000) return res.status(400).json({ message: "Nội dung tối đa 2000 ký tự" });
      if (!type || !VALID_TYPES.includes(type as NotificationType)) {
        return res.status(400).json({ message: "Loại thông báo không hợp lệ" });
      }
      if (priority && !VALID_PRIORITIES.includes(priority as NotificationPriority)) {
        return res.status(400).json({ message: "Mức ưu tiên không hợp lệ" });
      }
      if (!targetType || !OWNER_ALLOWED_TARGETS.includes(targetType as TargetType)) {
        return res.status(400).json({ message: "Loại đích gửi không hợp lệ hoặc ngoài phạm vi quyền" });
      }

      const result = await createNotification({
        title: title.trim(),
        message: message.trim(),
        type: type as NotificationType,
        priority: (priority as NotificationPriority) || NotificationPriority.NORMAL,
        source: NotificationSource.MANUAL,
        senderId: ownerId,
        senderRole: SenderRole.RESTAURANT_OWNER,
        targetType: targetType as TargetType,
        targetIds,
        restaurantId,
        ownerId,
        actionUrl,
        metadata
      });

      res.status(201).json({
        message: "Đã gửi thông báo thành công",
        notification: result.notification,
        recipientCount: result.recipientCount
      });
    } catch (error: any) {
      console.error("Lỗi khi gửi thông báo (owner):", error);
      res.status(400).json({ message: error.message || "Không thể gửi thông báo" });
    }
  }
);

// ──────────────────────────────────────────
// 3. Lấy thông báo của user hiện tại
// GET /api/notifications
// ──────────────────────────────────────────
router.get(
  "/notifications",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.sub;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      const unreadOnly = req.query.unreadOnly === "true";
      const type = req.query.type as string | undefined;

      // Build query
      const query: any = {
        recipientUserId: new mongoose.Types.ObjectId(userId),
        isArchived: false
      };

      if (unreadOnly) {
        query.isRead = false;
      }

      // Get recipient records
      const total = await NotificationRecipient.countDocuments(query);
      const recipients = await NotificationRecipient.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      // Get notification details
      const notificationIds = recipients.map(r => r.notificationId);
      const notificationQuery: any = { _id: { $in: notificationIds } };
      if (type && VALID_TYPES.includes(type as NotificationType)) {
        notificationQuery.type = type;
      }

      const { User } = await import("../models/User.js");
      const { Restaurant } = await import("../models/Restaurant.js");

      const notifications = await Notification.find(notificationQuery)
        .populate("senderId", "username fullName name role restaurantId")
        .lean();
      const notificationMap = new Map(notifications.map(n => [n._id.toString(), n]));

      // 1. Gather all restaurantIds directly on notifications
      const restIdsToFetch = new Set<string>();
      notifications.forEach(n => {
        if (n.restaurantId) {
          restIdsToFetch.add(n.restaurantId.toString());
        }
        if (n.senderId && (n.senderId as any).restaurantId) {
          restIdsToFetch.add((n.senderId as any).restaurantId.toString());
        }
      });

      // 2. Gather ownerIds to fetch their restaurants (in case they don't have direct restaurantId)
      const ownerIdsToFetch: any[] = [];
      notifications.forEach(n => {
        if (n.senderRole === SenderRole.RESTAURANT_OWNER && !n.restaurantId && n.senderId) {
          const oId = (n.senderId as any)._id || n.senderId;
          if (oId) ownerIdsToFetch.push(oId);
        }
      });

      // Fetch owners' restaurants
      const ownerRestaurantMap = new Map<string, string>();
      if (ownerIdsToFetch.length > 0) {
        const ownerRests = await Restaurant.find({ ownerId: { $in: ownerIdsToFetch } }).select("name ownerId").lean();
        ownerRests.forEach(r => {
          if (r.ownerId) {
            ownerRestaurantMap.set(r.ownerId.toString(), r.name);
          }
        });
      }

      // Fetch all restaurants by ID
      const restaurantMap = new Map<string, string>();
      if (restIdsToFetch.size > 0) {
        const rests = await Restaurant.find({ _id: { $in: Array.from(restIdsToFetch).map(id => new mongoose.Types.ObjectId(id)) } })
          .select("name")
          .lean();
        rests.forEach(r => {
          restaurantMap.set(r._id.toString(), r.name);
        });
      }

      // Combine data
      const result = recipients
        .map(r => {
          const n = notificationMap.get(r.notificationId.toString());
          if (!n) return null;
          // If type filter is applied and notification doesn't match, skip
          if (type && n.type !== type) return null;

          // Resolve sender name
          let senderName = "Hệ thống QDish";
          if (n.senderId) {
            const senderUser = n.senderId as any;
            const sRole = n.senderRole as string;
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

          // Resolve restaurant name
          let restaurantName: string | undefined = undefined;
          if (n.restaurantId) {
            restaurantName = restaurantMap.get(n.restaurantId.toString());
          }
          if (!restaurantName && n.senderId) {
            const senderUser = n.senderId as any;
            if (n.senderRole === SenderRole.RESTAURANT_OWNER) {
              restaurantName = ownerRestaurantMap.get(senderUser._id.toString());
            }
            if (!restaurantName && senderUser.restaurantId) {
              restaurantName = restaurantMap.get(senderUser.restaurantId.toString());
            }
          }

          return {
            id: r._id.toString(),
            notificationId: n._id.toString(),
            title: n.title,
            message: n.message,
            type: n.type,
            priority: n.priority,
            source: n.source,
            actionUrl: n.actionUrl,
            orderId: n.orderId?.toString(),
            subscriptionId: n.subscriptionId?.toString(),
            paymentTransactionId: n.paymentTransactionId?.toString(),
            senderRole: n.senderRole,
            senderId: n.senderId ? (n.senderId as any)._id?.toString() : undefined,
            sender: n.senderId ? {
              id: (n.senderId as any)._id?.toString(),
              name: senderName
            } : undefined,
            restaurant: restaurantName ? {
              name: restaurantName
            } : undefined,
            metadata: n.metadata,
            isRead: r.isRead,
            readAt: r.readAt,
            createdAt: n.createdAt
          };
        })
        .filter(Boolean);

      // Unread count (total, not just current page)
      const unreadCount = await NotificationRecipient.countDocuments({
        recipientUserId: new mongoose.Types.ObjectId(userId),
        isRead: false,
        isArchived: false
      });

      res.json({
        notifications: result,
        unreadCount,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error: any) {
      console.error("Lỗi khi lấy thông báo:", error);
      res.status(500).json({ message: "Không thể lấy danh sách thông báo" });
    }
  }
);

// ──────────────────────────────────────────
// 4. Lấy unread count
// GET /api/notifications/unread-count
// ──────────────────────────────────────────
router.get(
  "/notifications/unread-count",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.sub;
      const unreadCount = await NotificationRecipient.countDocuments({
        recipientUserId: new mongoose.Types.ObjectId(userId),
        isRead: false,
        isArchived: false
      });
      res.json({ unreadCount });
    } catch (error: any) {
      console.error("Lỗi khi lấy unread count:", error);
      res.status(500).json({ message: "Không thể lấy số thông báo chưa đọc" });
    }
  }
);

// ──────────────────────────────────────────
// 5. Mark read
// PATCH /api/notifications/:id/read
// ──────────────────────────────────────────
router.patch(
  "/notifications/:id/read",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.sub;
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: "ID thông báo không hợp lệ" });
      }

      const recipient = await NotificationRecipient.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(id),
          recipientUserId: new mongoose.Types.ObjectId(userId)
        },
        {
          $set: { isRead: true, readAt: new Date() }
        },
        { new: true }
      );

      if (!recipient) {
        return res.status(404).json({ message: "Không tìm thấy thông báo" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Lỗi khi đánh dấu đã đọc:", error);
      res.status(500).json({ message: "Không thể đánh dấu đã đọc" });
    }
  }
);

// ──────────────────────────────────────────
// 6. Mark all read
// PATCH /api/notifications/read-all
// ──────────────────────────────────────────
router.patch(
  "/notifications/read-all",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.sub;

      const result = await NotificationRecipient.updateMany(
        {
          recipientUserId: new mongoose.Types.ObjectId(userId),
          isRead: false,
          isArchived: false
        },
        {
          $set: { isRead: true, readAt: new Date() }
        }
      );

      res.json({ success: true, updatedCount: result.modifiedCount });
    } catch (error: any) {
      console.error("Lỗi khi đánh dấu tất cả đã đọc:", error);
      res.status(500).json({ message: "Không thể đánh dấu tất cả đã đọc" });
    }
  }
);

// ──────────────────────────────────────────
// 7. Archive notification
// PATCH /api/notifications/:id/archive
// ──────────────────────────────────────────
router.patch(
  "/notifications/:id/archive",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.sub;
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: "ID thông báo không hợp lệ" });
      }

      const recipient = await NotificationRecipient.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(id),
          recipientUserId: new mongoose.Types.ObjectId(userId)
        },
        {
          $set: { isArchived: true }
        },
        { new: true }
      );

      if (!recipient) {
        return res.status(404).json({ message: "Không tìm thấy thông báo" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Lỗi khi ẩn thông báo:", error);
      res.status(500).json({ message: "Không thể ẩn thông báo" });
    }
  }
);

// ──────────────────────────────────────────
// Helper: Get data for admin target selectors
// GET /api/admin/notifications/targets
// ──────────────────────────────────────────
router.get(
  "/admin/notifications/targets",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (_req: AuthRequest, res) => {
    try {
      const [owners, restaurants] = await Promise.all([
        (await import("../models/User.js")).User.find({
          role: UserRole.RESTAURANT_OWNER,
          isActive: true
        }).select("_id username fullName email").lean(),
        (await import("../models/Restaurant.js")).Restaurant.find().select("_id name ownerId").lean()
      ]);

      res.json({
        owners: owners.map(o => ({
          id: o._id.toString(),
          username: o.username,
          fullName: o.fullName,
          email: o.email
        })),
        restaurants: restaurants.map(r => ({
          id: r._id.toString(),
          name: r.name,
          ownerId: r.ownerId?.toString()
        }))
      });
    } catch (error: any) {
      console.error("Lỗi khi lấy targets:", error);
      res.status(500).json({ message: "Không thể lấy danh sách đích gửi" });
    }
  }
);

// ──────────────────────────────────────────
// Helper: Get Owner's restaurants for target selector
// GET /api/owner/notifications/targets
// ──────────────────────────────────────────
router.get(
  "/owner/notifications/targets",
  requireAuth,
  requireRole(UserRole.RESTAURANT_OWNER as string),
  async (req: AuthRequest, res) => {
    try {
      const ownerId = req.auth!.sub;
      const restaurants = await (await import("../models/Restaurant.js")).Restaurant.find({
        ownerId: new mongoose.Types.ObjectId(ownerId)
      }).select("_id name").lean();

      res.json({
        restaurants: restaurants.map(r => ({
          id: r._id.toString(),
          name: r.name
        }))
      });
    } catch (error: any) {
      console.error("Lỗi khi lấy targets (owner):", error);
      res.status(500).json({ message: "Không thể lấy danh sách đích gửi" });
    }
  }
);

export default router;
