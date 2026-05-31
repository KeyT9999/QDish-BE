import { Router } from "express";
import { Order, OrderStatus } from "../models/Order.js";
import mongoose from "mongoose";
import { Restaurant, RestaurantStatus } from "../models/Restaurant.js";
import { Table } from "../models/Table.js";
import { TableSession, TableSessionStatus } from "../models/TableSession.js";
import {
  getCustomerOrderHistory,
  resolveTableSession,
  TableSessionLifecycleError
} from "../services/tableSessionLifecycleService.js";
import {
  appendOrderToBill,
  resolveActiveBillForSession,
  BillLifecycleError
} from "../services/billLifecycleService.js";
import { sendNewOrderNotification } from "../services/emailService.js";
import { emitNewOrder } from "../realtime/socket.js";
import { createSystemNotification } from "../services/notificationService.js";
import { NotificationType, NotificationPriority } from "../models/Notification.js";
import { User, UserRole } from "../models/User.js";

const router = Router();

// Khách hàng đặt món (không cần auth)
router.post("/", async (req, res) => {
  const { restaurantId, tableNumber, items, note, customerName, tableSessionId } = req.body as {
    restaurantId?: string;
    tableNumber?: string;
    items?: Array<{ menuItemId: string; name: string; price: number; quantity: number }>;
    note?: string;
    customerName?: string;
    tableSessionId?: string;
  };

  if (!restaurantId || !tableNumber || !items || items.length === 0) {
    return res.status(400).json({ message: "Thiếu thông tin đơn hàng" });
  }

  if (!mongoose.isValidObjectId(restaurantId)) {
    return res.status(400).json({ message: "restaurantId không hợp lệ" });
  }

  const normalizedCustomerName = customerName?.trim();
  if (normalizedCustomerName && normalizedCustomerName.length < 2) {
    return res.status(400).json({ message: "Tên khách hàng phải có ít nhất 2 ký tự" });
  }

  const hasInvalidItem = items.some(item =>
    !item.menuItemId ||
    !item.name?.trim() ||
    typeof item.price !== "number" ||
    item.price < 0 ||
    typeof item.quantity !== "number" ||
    item.quantity <= 0
  );

  if (hasInvalidItem) {
    return res.status(400).json({ message: "Danh sách món không hợp lệ" });
  }

  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant || restaurant.status !== RestaurantStatus.ACTIVE || restaurant.active === false) {
    return res.status(404).json({ message: "Không tìm thấy nhà hàng đang hoạt động" });
  }

  const table = await Table.findOne({
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    code: tableNumber,
    isActive: true
  });

  if (!table) {
    return res.status(404).json({ message: "Bàn không tồn tại trong nhà hàng" });
  }

  // ── Resolve active session ──
  let session: InstanceType<typeof TableSession> | null = null;

  if (tableSessionId) {
    if (!mongoose.isValidObjectId(tableSessionId)) {
      return res.status(400).json({ message: "Phien ban khong hop le" });
    }

    // Verify session exists and is OPEN
    session = await TableSession.findOne({
      _id: tableSessionId,
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      tableNumber,
      status: { $in: [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_REQUESTED] }
    });

    if (!session) {
      return res.status(400).json({
        message: "Phiên bàn không hợp lệ hoặc đã kết thúc. Vui lòng quét lại mã QR."
      });
    }
  } else {
    try {
      const resolved = await resolveTableSession({ restaurantId, tableNumber });
      session = resolved.session;
    } catch (error) {
      if (error instanceof TableSessionLifecycleError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Loi khi resolve phien ban de tao order:", error);
      return res.status(500).json({ message: "Khong the khoi tao phien ban cho order", error });
    }

    if (!session || session.status !== TableSessionStatus.OPEN) {
      return res.status(400).json({
        message: "Ban dang cho thanh toan. Vui long hoan tat thanh toan truoc khi goi them mon."
      });
    }
  }

  // Allow placing multiple orders for the same table (customer ordering multiple rounds)

  let bill: any;
  try {
    bill = await resolveActiveBillForSession(session);
  } catch (error) {
    if (error instanceof BillLifecycleError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("Loi khi resolve bill de tao order:", error);
    return res.status(500).json({ message: "Khong the khoi tao bill cho order", error });
  }

  const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const order = await Order.create({
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    tableNumber,
    tableSessionId: session ? session._id : undefined,
    billId: bill._id,
    sessionCode: session ? session.sessionCode : undefined,
    billCode: bill.billCode,
    billStatus: bill.status,
    items,
    totalAmount,
    status: OrderStatus.PENDING,
    note,
    customerName: normalizedCustomerName || undefined
  });

  try {
    bill = await appendOrderToBill(order, session);
  } catch (error) {
    if (error instanceof BillLifecycleError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("Loi khi cap nhat bill sau khi tao order:", error);
    return res.status(500).json({ message: "Khong the cap nhat bill", error });
  }

  emitNewOrder(restaurantId, order.toJSON());

  // Auto notification: new order
  try {
    const restaurantStaff = await User.find({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      role: { $in: [UserRole.RESTAURANT_ADMIN, UserRole.STAFF] },
      isActive: true
    }).select("_id");

    const itemCount = items.reduce((sum: number, item: any) => sum + item.quantity, 0);
    if (restaurantStaff.length > 0) {
      await createSystemNotification({
        title: "Đơn hàng mới",
        message: `Bàn ${tableNumber} vừa đặt ${itemCount} món - ${totalAmount.toLocaleString("vi-VN")}đ`,
        type: NotificationType.ORDER,
        priority: NotificationPriority.URGENT,
        recipientUserIds: restaurantStaff.map(s => s._id),
        restaurantId,
        orderId: order._id.toString(),
        actionUrl: `/dashboard?tab=orders`
      });
    }
  } catch (notifError) {
    console.error("Không thể gửi notification đơn hàng mới", notifError);
  }

  // Gửi email thông báo đơn hàng mới cho chủ quán
  try {
    if (restaurant && restaurant.email) {
      await sendNewOrderNotification({
        to: restaurant.email,
        restaurantName: restaurant.name,
        ownerName: restaurant.ownerName,
        orderId: order._id.toString(),
        tableNumber,
        items: items.map(item => ({
          name: item.name,
          price: item.price,
          quantity: item.quantity
        })),
        totalAmount,
        note,
        orderTime: order.createdAt || new Date()
      });
    }
  } catch (emailError) {
    // Không làm gián đoạn việc tạo đơn hàng nếu gửi email thất bại
    console.error("Không thể gửi email thông báo đơn hàng mới", emailError);
  }

  res.status(201).json(order);
});

// Lấy đơn hàng theo restaurantId và tableNumber (cho khách xem)
router.get("/", async (req, res) => {
  const { restaurantId, tableNumber, sessionId } = req.query as {
    restaurantId?: string;
    tableNumber?: string;
    sessionId?: string;
  };

  if (!restaurantId || !tableNumber) {
    return res.status(400).json({ message: "Thiếu restaurantId hoặc tableNumber" });
  }

  if (!mongoose.isValidObjectId(restaurantId)) {
    return res.status(400).json({ message: "restaurantId không hợp lệ" });
  }

  try {
    const orders = await getCustomerOrderHistory({
      restaurantId,
      tableNumber,
      sessionId
    });

    return res.json(orders);
  } catch (error) {
    if (error instanceof TableSessionLifecycleError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("Loi khi lay lich su order theo phien:", error);
    return res.status(500).json({ message: "Khong the lay lich su goi mon", error });
  }
});

export default router;
