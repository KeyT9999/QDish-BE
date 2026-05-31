import { Router } from "express";
import bcrypt from "bcryptjs";
import { User, UserRole } from "../models/User.js";
import { Order, OrderStatus } from "../models/Order.js";
import { AuthRequest, requireAuth, requireRole } from "../middleware/auth.js";
import mongoose from "mongoose";
import { emitBillPaid, emitOrderUpdated, emitTableSessionClosed, emitTableStatusUpdated } from "../realtime/socket.js";
import { createSystemNotification } from "../services/notificationService.js";
import { NotificationType, NotificationPriority } from "../models/Notification.js";
import { TableStatus } from "../models/Table.js";
import { closeTableSession, TableSessionLifecycleError } from "../services/tableSessionLifecycleService.js";
import { BillLifecycleError, payBill } from "../services/billLifecycleService.js";

const router = Router();

// Lấy danh sách nhân viên của nhà hàng
router.get("/", requireAuth, requireRole([UserRole.RESTAURANT_ADMIN] as string[]), async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId) {
    return res.status(403).json({ message: "Không xác định được nhà hàng" });
  }
  const staffList = await User.find({
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    role: UserRole.STAFF
  })
    .select("_id username role isActive name updatedBy")
    .populate("updatedBy", "username")
    .lean();

  res.json(staffList.map(s => ({
    id: s._id,
    username: s.username,
    role: s.role,
    isActive: s.isActive ?? true,
    name: s.name || "",
    updatedBy: s.updatedBy ? {
      id: (s.updatedBy as any)._id,
      username: (s.updatedBy as any).username
    } : null
  })));
});

// Admin nhà hàng tạo tài khoản nhân viên
router.post("/", requireAuth, requireRole([UserRole.RESTAURANT_ADMIN] as string[]), async (req: AuthRequest, res) => {
  const { username, password, name } = req.body as { username?: string; password?: string; name?: string };
  const restaurantId = req.auth?.restaurantId;
  const adminId = req.auth?.sub;

  if (!username || !password) {
    return res.status(400).json({ message: "Thiếu username hoặc password" });
  }

  if (!restaurantId) {
    return res.status(403).json({ message: "Không xác định được nhà hàng" });
  }

  if (!adminId) {
    return res.status(403).json({ message: "Không xác định được admin" });
  }

  // Kiểm tra giới hạn số lượng nhân viên (STAFF) của gói dịch vụ
  try {
    const { resolveOwnerByRestaurant, checkPlanLimit } = await import("../services/subscriptionService.js");
    const ownerId = await resolveOwnerByRestaurant(restaurantId);
    if (ownerId) {
      const limitError = await checkPlanLimit(ownerId, "STAFF_LIMIT");
      if (limitError) {
        return res.status(403).json({
          message: limitError.message,
          code: "PLAN_LIMIT_REACHED",
          limitType: "STAFF_LIMIT",
          currentPlan: limitError.currentPlan,
          upgradeRequired: true
        });
      }
    }
  } catch (err) {
    console.error("Lỗi khi kiểm tra giới hạn nhân viên:", err);
  }

  const existingUser = await User.findOne({ username });
  if (existingUser) {
    return res.status(400).json({ message: "Username đã tồn tại" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const staff = await User.create({
    username,
    passwordHash,
    role: UserRole.STAFF,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    name: name?.trim() || "",
    updatedBy: new mongoose.Types.ObjectId(adminId)
  });

  const updatedByUser = await User.findById(adminId).select("username");

  res.status(201).json({
    id: staff._id,
    username: staff.username,
    role: staff.role,
    restaurantId: staff.restaurantId,
    name: staff.name || "",
    updatedBy: updatedByUser ? {
      id: updatedByUser._id,
      username: updatedByUser.username
    } : null
  });
});

// Nhân viên xem danh sách đơn hàng của nhà hàng
router.get("/orders", requireAuth, requireRole([UserRole.STAFF, UserRole.RESTAURANT_ADMIN] as string[]), async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId) {
    return res.status(403).json({ message: "Không xác định được nhà hàng" });
  }

  const orders = await Order.find({ restaurantId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  res.json(orders);
});

// Nhân viên xác nhận đơn (chuyển status)
router.patch("/orders/:id", requireAuth, requireRole([UserRole.STAFF, UserRole.RESTAURANT_ADMIN] as string[]), async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  const userId = req.auth?.sub;
  const userRole = req.auth?.role;
  const { id } = req.params;
  const { status, paymentMethod, cashReceived } = req.body as {
    status?: string;
    paymentMethod?: string;
    cashReceived?: number;
  };

  if (!restaurantId) {
    return res.status(403).json({ message: "Không xác định được nhà hàng" });
  }

  if (!status || !Object.values(OrderStatus).includes(status as OrderStatus)) {
    return res.status(400).json({ message: "Trạng thái đơn hàng không hợp lệ" });
  }

  if (status === OrderStatus.COMPLETED) {
    return res.status(400).json({
      message: "Thanh toan chi duoc thuc hien o cap bill. Vui long dung API /api/bills/:billId/pay."
    });
  }

  // Kiểm tra đơn hàng tồn tại và lấy trạng thái hiện tại
  const existingOrder = await Order.findOne({ _id: id, restaurantId });
  if (!existingOrder) {
    return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
  }

  // Nhân viên (STAFF) được phép xử lý đơn theo thứ tự POS.
  if (userRole === UserRole.STAFF) {
    if (status !== OrderStatus.CONFIRMED && status !== OrderStatus.SERVED) {
      return res.status(403).json({ message: "Nhan vien chi duoc xac nhan hoac bao ra mon. Thanh toan thi dung bill." });
    }
    if (status === OrderStatus.CONFIRMED && existingOrder.status !== OrderStatus.PENDING) {
      return res.status(403).json({ message: "Chỉ có thể xác nhận đơn hàng đang chờ xử lý" });
    }
    if (status === OrderStatus.SERVED && existingOrder.status !== OrderStatus.CONFIRMED) {
      return res.status(403).json({ message: "Chỉ có thể báo ra món cho đơn hàng đã xác nhận" });
    }
  }

  // Lấy thông tin người cập nhật để lưu tên
  let updatedByName = "";
  let confirmedByName = "";
  if (userId) {
    const user = await User.findById(userId).select("name username");
    if (user) {
      const userName = user.name || user.username || "";
      updatedByName = userName;
      // Lưu confirmedByName riêng cho trạng thái CONFIRMED
      if (status === OrderStatus.CONFIRMED) {
        confirmedByName = userName;
      }
    }
  }

  const updateData: any = { status: status as OrderStatus };
  
  // Lưu hình thức thanh toán khi hoàn thành đơn hàng
  if (status === OrderStatus.COMPLETED && paymentMethod) {
    if (paymentMethod === "CASH" || paymentMethod === "BANK_TRANSFER") {
      updateData.paymentMethod = paymentMethod;
    } else {
      return res.status(400).json({ message: "Hình thức thanh toán không hợp lệ" });
    }
  }
  
  // Lưu thông tin người cập nhật cho mọi trạng thái
  if (userId) {
    updateData.updatedBy = new mongoose.Types.ObjectId(userId);
    updateData.updatedByName = updatedByName;
  }
  
  // Lưu thông tin nhân viên khi xác nhận đơn (CONFIRMED)
  if (status === OrderStatus.CONFIRMED && userId) {
    updateData.confirmedBy = new mongoose.Types.ObjectId(userId);
    updateData.confirmedByName = confirmedByName;
  }

  const order = await Order.findOneAndUpdate(
    { _id: id, restaurantId },
    updateData,
    { new: true }
  );

  if (!order) {
    return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
  }

  let responseOrder = order;

  if (status === OrderStatus.COMPLETED && order.billId) {
    try {
      const result = await payBill({
        billId: order.billId,
        restaurantId,
        paymentMethod,
        cashReceived,
        paidBy: userId
      });

      emitBillPaid(restaurantId, result.bill.toJSON());
      emitTableSessionClosed(restaurantId, result.session.toJSON());
      if (result.table) {
        emitTableStatusUpdated(restaurantId, {
          tableId: result.table._id,
          code: result.table.code,
          status: result.table.status,
          activeSessionId: result.table.activeSessionId,
          currentSessionCode: result.table.currentSessionCode
        });
      }
      const refreshedOrder = await Order.findById(order._id);
      if (refreshedOrder) {
        responseOrder = refreshedOrder;
      }
    } catch (error) {
      if (error instanceof BillLifecycleError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Khong the thanh toan bill tu order", error);
      return res.status(500).json({ message: "Khong the thanh toan bill", error });
    }
  } else if (status === OrderStatus.COMPLETED && order.tableSessionId) {
    try {
      const { session, table } = await closeTableSession({
        sessionId: order.tableSessionId,
        restaurantId,
        paymentMethod,
        markPaid: true,
        closedBy: userId
      });

      emitTableSessionClosed(restaurantId, session.toJSON());
      if (table) {
        emitTableStatusUpdated(restaurantId, {
          tableId: table._id,
          code: table.code,
          status: TableStatus.AVAILABLE,
          activeSessionId: null,
          currentSessionCode: null
        });
      }
    } catch (error) {
      if (error instanceof TableSessionLifecycleError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Khong the dong phien ban sau khi thanh toan order", error);
      return res.status(500).json({ message: "Khong the dong phien ban sau thanh toan", error });
    }
  }

  emitOrderUpdated(restaurantId, responseOrder.toJSON());

  // Auto notification: order status updated
  try {
    const restaurantStaff = await User.find({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      role: { $in: [UserRole.RESTAURANT_ADMIN, UserRole.STAFF] },
      isActive: true
    }).select("_id");

    const recipientUserIds = restaurantStaff.map(s => s._id);

    // Resolve owner
    const { resolveOwnerByRestaurant } = await import("../services/subscriptionService.js");
    const ownerId = await resolveOwnerByRestaurant(restaurantId);
    if (ownerId && !recipientUserIds.some(id => id.toString() === ownerId.toString())) {
      recipientUserIds.push(ownerId);
    }

    if (recipientUserIds.length > 0) {
      await createSystemNotification({
        title: "Đơn hàng cập nhật",
        message: `Đơn hàng bàn ${responseOrder.tableNumber} đã chuyển sang trạng thái [${status}] bởi ${updatedByName}`,
        type: NotificationType.ORDER,
        priority: NotificationPriority.NORMAL,
        recipientUserIds,
        restaurantId,
        orderId: order._id.toString(),
        actionUrl: `/dashboard?tab=orders`
      });
    }
  } catch (notifError) {
    console.error("Không thể gửi notification cập nhật đơn hàng", notifError);
  }

  res.json(responseOrder);
});

// Khóa/mở khóa nhân viên
router.patch("/:id/toggle-active", requireAuth, requireRole([UserRole.RESTAURANT_ADMIN] as string[]), async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  const { id } = req.params;

  if (!restaurantId) {
    return res.status(403).json({ message: "Không xác định được nhà hàng" });
  }

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "ID nhân viên không hợp lệ" });
  }

  try {
    const staff = await User.findOne({
      _id: id,
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      role: UserRole.STAFF
    });

    if (!staff) {
      return res.status(404).json({ message: "Không tìm thấy nhân viên" });
    }

    staff.isActive = !(staff.isActive ?? true);
    await staff.save();

    res.json({
      id: staff._id,
      username: staff.username,
      role: staff.role,
      isActive: staff.isActive
    });
  } catch (error) {
    res.status(500).json({ message: "Lỗi server khi cập nhật trạng thái nhân viên", error });
  }
});

// Cập nhật username/password/name nhân viên
router.patch("/:id", requireAuth, requireRole([UserRole.RESTAURANT_ADMIN] as string[]), async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  const adminId = req.auth?.sub;
  const { id } = req.params;
  const { username, password, name } = req.body as { username?: string; password?: string; name?: string };

  if (!restaurantId) {
    return res.status(403).json({ message: "Không xác định được nhà hàng" });
  }

  if (!adminId) {
    return res.status(403).json({ message: "Không xác định được admin" });
  }

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "ID nhân viên không hợp lệ" });
  }

  if (!username && !password && !name) {
    return res.status(400).json({ message: "Cần cung cấp username, password hoặc name để cập nhật" });
  }

  try {
    const staff = await User.findOne({
      _id: id,
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      role: UserRole.STAFF
    });

    if (!staff) {
      return res.status(404).json({ message: "Không tìm thấy nhân viên" });
    }

    if (username && username.trim() !== staff.username) {
      // Kiểm tra username mới có trùng không
      const existingUser = await User.findOne({ username: username.trim() });
      if (existingUser && existingUser._id.toString() !== id) {
        return res.status(400).json({ message: "Username đã tồn tại" });
      }
      staff.username = username.trim();
    }

    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      staff.passwordHash = passwordHash;
    }

    if (name !== undefined) {
      staff.name = name.trim() || "";
    }

    // Cập nhật updatedBy
    staff.updatedBy = new mongoose.Types.ObjectId(adminId);

    await staff.save();

    const updatedByUser = await User.findById(adminId).select("username");

    res.json({
      id: staff._id,
      username: staff.username,
      role: staff.role,
      isActive: staff.isActive ?? true,
      name: staff.name || "",
      updatedBy: updatedByUser ? {
        id: updatedByUser._id,
        username: updatedByUser.username
      } : null
    });
  } catch (error) {
    res.status(500).json({ message: "Lỗi server khi cập nhật nhân viên", error });
  }
});

export default router;
