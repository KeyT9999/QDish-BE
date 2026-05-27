import { Router } from "express";
import mongoose from "mongoose";

import { AuthRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { Order } from "../models/Order.js";
import { Restaurant, RestaurantStatus } from "../models/Restaurant.js";
import { Table, TableStatus } from "../models/Table.js";
import { SessionCreatedBy, TableSession, TableSessionStatus } from "../models/TableSession.js";
import { UserRole } from "../models/User.js";
import { BillStatus } from "../models/Bill.js";
import {
  emitTableSessionClosed,
  emitTableSessionOpened,
  emitTableStatusUpdated
} from "../realtime/socket.js";
import { resolveActiveBillForSession } from "../services/billLifecycleService.js";
import {
  closeTableSession,
  resolveTableSession,
  TableSessionLifecycleError
} from "../services/tableSessionLifecycleService.js";

const router = Router();

const handleLifecycleError = (res: any, error: unknown) => {
  if (error instanceof TableSessionLifecycleError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  return null;
};

router.post("/resolve", async (req, res) => {
  try {
    const { restaurantId, tableNumber } = req.body as {
      restaurantId?: string;
      tableNumber?: string;
    };

    if (!restaurantId || !tableNumber) {
      return res.status(400).json({ message: "Thieu restaurantId hoac tableNumber" });
    }

    if (!mongoose.isValidObjectId(restaurantId)) {
      return res.status(400).json({ message: "restaurantId khong hop le" });
    }

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant || restaurant.status !== RestaurantStatus.ACTIVE || restaurant.active === false) {
      return res.status(404).json({ message: "Khong tim thay nha hang dang hoat dong" });
    }

    const { session, table, created } = await resolveTableSession({
      restaurantId,
      tableNumber,
      createdBy: SessionCreatedBy.CUSTOMER_SCAN
    });
    const bill = await resolveActiveBillForSession(session);

    if (created) {
      emitTableSessionOpened(restaurantId, session.toJSON());
    }

    emitTableStatusUpdated(restaurantId, {
      tableId: table?._id,
      code: tableNumber,
      status: table?.status,
      activeSessionId: table?.activeSessionId,
      currentSessionCode: table?.currentSessionCode
    });

    return res.json({ session, bill });
  } catch (error) {
    const handled = handleLifecycleError(res, error);
    if (handled) return handled;
    console.error("Loi khi resolve table session:", error);
    return res.status(500).json({ message: "Khong the khoi tao phien ban", error });
  }
});

router.patch(
  "/:id/close",
  requireAuth,
  requireRole([UserRole.RESTAURANT_ADMIN, UserRole.STAFF, UserRole.RESTAURANT_OWNER] as string[]),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const restaurantId = req.auth?.restaurantId;
      const userId = req.auth?.sub;

      if (!restaurantId) {
        return res.status(403).json({ message: "Khong xac dinh duoc nha hang" });
      }

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: "Session ID khong hop le" });
      }

      const { paymentMethod, note } = req.body as {
        paymentMethod?: string;
        note?: string;
      };

      const { session, table } = await closeTableSession({
        sessionId: id,
        restaurantId,
        paymentMethod,
        markPaid: Boolean(paymentMethod),
        closedBy: userId,
        note
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

      return res.json({ session, table });
    } catch (error) {
      const handled = handleLifecycleError(res, error);
      if (handled) return handled;
      console.error("Loi khi dong phien ban:", error);
      return res.status(500).json({ message: "Khong the dong phien ban", error });
    }
  }
);

router.patch(
  "/:id/request-payment",
  requireAuth,
  requireRole([UserRole.RESTAURANT_ADMIN, UserRole.STAFF, UserRole.RESTAURANT_OWNER] as string[]),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const restaurantId = req.auth?.restaurantId;
      const { paymentMethod } = req.body as { paymentMethod?: string };

      if (!restaurantId) {
        return res.status(403).json({ message: "Khong xac dinh duoc nha hang" });
      }

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: "Session ID khong hop le" });
      }

      const session = await TableSession.findOne({
        _id: id,
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        status: { $in: [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_REQUESTED] }
      });

      if (!session) {
        return res.status(404).json({ message: "Khong tim thay phien ban dang mo" });
      }

      if (session.status === TableSessionStatus.OPEN) {
        session.status = TableSessionStatus.PAYMENT_REQUESTED;
      }
      session.metadata = {
        ...((session.metadata as Record<string, unknown>) || {}),
        requestedPaymentMethod: paymentMethod,
        paymentRequestedAt: new Date()
      };
      await session.save();
      const bill = await resolveActiveBillForSession(session);
      if (bill.status === BillStatus.UNPAID) {
        bill.status = BillStatus.PAYMENT_REQUESTED;
        await bill.save();
      }

      const table = await Table.findByIdAndUpdate(
        session.tableId,
        { status: TableStatus.PAYMENT_PENDING },
        { new: true }
      );

      emitTableStatusUpdated(restaurantId, {
        tableId: session.tableId,
        code: session.tableNumber,
        status: TableStatus.PAYMENT_PENDING,
        activeSessionId: session._id,
        currentSessionCode: session.sessionCode
      });

      return res.json({ session, table, bill });
    } catch (error) {
      return res.status(500).json({ message: "Khong the yeu cau thanh toan", error });
    }
  }
);

router.get(
  "/active",
  requireAuth,
  requireRole([UserRole.RESTAURANT_ADMIN, UserRole.STAFF, UserRole.RESTAURANT_OWNER] as string[]),
  async (req: AuthRequest, res) => {
    try {
      const restaurantId = req.auth?.restaurantId;

      if (!restaurantId) {
        return res.status(403).json({ message: "Khong xac dinh duoc nha hang" });
      }

      const sessions = await TableSession.find({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        status: { $in: [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_REQUESTED] }
      }).sort({ openedAt: -1 }).lean();

      return res.json({ sessions });
    } catch (error) {
      return res.status(500).json({ message: "Khong the lay danh sach phien", error });
    }
  }
);

router.get(
  "/",
  requireAuth,
  requireRole([UserRole.RESTAURANT_ADMIN, UserRole.RESTAURANT_OWNER, UserRole.SUPER_ADMIN] as string[]),
  async (req: AuthRequest, res) => {
    try {
      const restaurantId = req.auth?.restaurantId;
      const queryRestaurantId = (req.query.restaurantId as string) || restaurantId;

      if (!queryRestaurantId) {
        return res.status(400).json({ message: "Thieu restaurantId" });
      }

      if (!mongoose.isValidObjectId(queryRestaurantId)) {
        return res.status(400).json({ message: "restaurantId khong hop le" });
      }

      const { status, tableNumber, page = "1", limit = "20" } = req.query as {
        status?: string;
        tableNumber?: string;
        page?: string;
        limit?: string;
      };

      const filter: Record<string, unknown> = {
        restaurantId: new mongoose.Types.ObjectId(queryRestaurantId)
      };

      if (status && Object.values(TableSessionStatus).includes(status as TableSessionStatus)) {
        filter.status = status;
      }

      if (tableNumber) {
        filter.tableNumber = tableNumber;
      }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const skip = (pageNum - 1) * limitNum;

      const [sessions, total] = await Promise.all([
        TableSession.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        TableSession.countDocuments(filter)
      ]);

      return res.json({
        sessions,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      });
    } catch (error) {
      return res.status(500).json({ message: "Khong the lay lich su phien", error });
    }
  }
);

router.get(
  "/:id/orders",
  requireAuth,
  requireRole([UserRole.RESTAURANT_ADMIN, UserRole.STAFF, UserRole.RESTAURANT_OWNER] as string[]),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const restaurantId = req.auth?.restaurantId;

      if (!restaurantId) {
        return res.status(403).json({ message: "Khong xac dinh duoc nha hang" });
      }

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: "Session ID khong hop le" });
      }

      const session = await TableSession.findOne({
        _id: id,
        restaurantId: new mongoose.Types.ObjectId(restaurantId)
      });

      if (!session) {
        return res.status(404).json({ message: "Khong tim thay phien ban" });
      }

      const orders = await Order.find({
        tableSessionId: new mongoose.Types.ObjectId(id)
      }).sort({ createdAt: -1 }).lean();

      return res.json({ session, orders });
    } catch (error) {
      return res.status(500).json({ message: "Khong the lay don hang cua phien", error });
    }
  }
);

export default router;
