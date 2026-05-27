import { Router } from "express";
import mongoose from "mongoose";

import { AuthRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { Bill } from "../models/Bill.js";
import { Order } from "../models/Order.js";
import { Restaurant, RestaurantStatus } from "../models/Restaurant.js";
import { Table } from "../models/Table.js";
import { TableSession } from "../models/TableSession.js";
import { UserRole } from "../models/User.js";
import { emitBillPaid, emitOrderUpdated, emitTableSessionClosed, emitTableStatusUpdated } from "../realtime/socket.js";
import {
  BillLifecycleError,
  getActiveBillsForRestaurant,
  getCurrentBillForCustomer,
  listBillsForRestaurant,
  payBill
} from "../services/billLifecycleService.js";

const router = Router();

const billRoles = [
  UserRole.RESTAURANT_ADMIN,
  UserRole.RESTAURANT_OWNER,
  UserRole.STAFF
] as string[];

const historyRoles = [
  UserRole.RESTAURANT_ADMIN,
  UserRole.RESTAURANT_OWNER,
  UserRole.STAFF,
  UserRole.SUPER_ADMIN
] as string[];

const handleBillError = (res: any, error: unknown) => {
  if (error instanceof BillLifecycleError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  return null;
};

const resolveAuthorizedRestaurantId = (req: AuthRequest) => {
  const requestedRestaurantId = req.query.restaurantId as string | undefined;
  const authRestaurantId = req.auth?.restaurantId || undefined;
  const role = req.auth?.role;

  if (role === UserRole.SUPER_ADMIN) {
    if (!requestedRestaurantId) {
      throw new BillLifecycleError(400, "Thieu restaurantId");
    }
    if (!mongoose.isValidObjectId(requestedRestaurantId)) {
      throw new BillLifecycleError(400, "restaurantId khong hop le");
    }
    return requestedRestaurantId;
  }

  if (!authRestaurantId) {
    throw new BillLifecycleError(403, "Khong xac dinh duoc nha hang");
  }

  if (requestedRestaurantId && requestedRestaurantId !== authRestaurantId) {
    throw new BillLifecycleError(403, "Khong co quyen xem bill cua nha hang khac");
  }

  if (!mongoose.isValidObjectId(authRestaurantId)) {
    throw new BillLifecycleError(400, "restaurantId khong hop le");
  }

  return authRestaurantId;
};

router.get("/current", async (req, res) => {
  try {
    const { restaurantId, tableNumber, sessionId } = req.query as {
      restaurantId?: string;
      tableNumber?: string;
      sessionId?: string;
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

    const table = await Table.findOne({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      code: tableNumber,
      isActive: true
    });
    if (!table) {
      return res.status(404).json({ message: "Ban khong ton tai trong nha hang" });
    }

    const result = await getCurrentBillForCustomer({ restaurantId, tableNumber, sessionId });
    return res.json(result);
  } catch (error) {
    const handled = handleBillError(res, error);
    if (handled) return handled;
    console.error("Loi khi lay current bill:", error);
    return res.status(500).json({ message: "Khong the lay bill hien tai", error });
  }
});

router.get(
  "/active",
  requireAuth,
  requireRole(billRoles),
  async (req: AuthRequest, res) => {
    try {
      const restaurantId = resolveAuthorizedRestaurantId(req);

      const bills = await getActiveBillsForRestaurant({ restaurantId });
      return res.json({ bills });
    } catch (error) {
      const handled = handleBillError(res, error);
      if (handled) return handled;
      console.error("Loi khi lay active bills:", error);
      return res.status(500).json({ message: "Khong the lay active bills", error });
    }
  }
);

router.patch(
  "/:id/pay",
  requireAuth,
  requireRole(billRoles),
  async (req: AuthRequest, res) => {
    try {
      const restaurantId = req.auth?.restaurantId;
      const userId = req.auth?.sub;
      const { id } = req.params;
      const { paymentMethod, cashReceived } = req.body as {
        paymentMethod?: string;
        cashReceived?: number;
      };

      if (!restaurantId) {
        return res.status(403).json({ message: "Khong xac dinh duoc nha hang" });
      }

      const result = await payBill({
        billId: id,
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

      const paidOrders = await Order.find({ billId: result.bill._id }).lean();
      for (const paidOrder of paidOrders) {
        emitOrderUpdated(restaurantId, paidOrder);
      }

      return res.json(result);
    } catch (error) {
      const handled = handleBillError(res, error);
      if (handled) return handled;
      console.error("Loi khi thanh toan bill:", error);
      return res.status(500).json({ message: "Khong the thanh toan bill", error });
    }
  }
);

router.get(
  "/",
  requireAuth,
  requireRole(historyRoles),
  async (req: AuthRequest, res) => {
    try {
      const queryRestaurantId = resolveAuthorizedRestaurantId(req);
      const {
        tableNumber,
        status,
        search,
        dateFrom,
        dateTo,
        page = "1",
        limit = "20"
      } = req.query as {
        tableNumber?: string;
        status?: string;
        search?: string;
        dateFrom?: string;
        dateTo?: string;
        page?: string;
        limit?: string;
      };

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

      const result = await listBillsForRestaurant({
        restaurantId: queryRestaurantId,
        status,
        tableNumber,
        search,
        dateFrom,
        dateTo,
        page: pageNum,
        limit: limitNum
      });

      return res.json(result);
    } catch (error) {
      const handled = handleBillError(res, error);
      if (handled) return handled;
      return res.status(500).json({ message: "Khong the lay lich su bill", error });
    }
  }
);

router.get(
  "/:id",
  requireAuth,
  requireRole(historyRoles),
  async (req: AuthRequest, res) => {
    try {
      const queryRestaurantId = resolveAuthorizedRestaurantId(req);
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: "Bill ID khong hop le" });
      }

      const bill = await Bill.findOne({
        _id: id,
        restaurantId: new mongoose.Types.ObjectId(queryRestaurantId)
      }).lean();
      if (!bill) {
        return res.status(404).json({ message: "Khong tim thay bill" });
      }

      const [session, orders] = await Promise.all([
        TableSession.findById(bill.tableSessionId).lean(),
        Order.find({
          $or: [
            { billId: bill._id },
            {
              tableSessionId: bill.tableSessionId,
              billId: { $exists: false }
            },
            {
              tableSessionId: bill.tableSessionId,
              billId: null
            }
          ]
        }).sort({ createdAt: -1 }).lean()
      ]);

      return res.json({ bill, session, orders });
    } catch (error) {
      const handled = handleBillError(res, error);
      if (handled) return handled;
      return res.status(500).json({ message: "Khong the lay chi tiet bill", error });
    }
  }
);

export default router;
