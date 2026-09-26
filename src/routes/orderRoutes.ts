import { Router } from "express";
import { performance } from "node:perf_hooks";
import { Order, OrderStatus, type IOrder } from "../models/Order.js";
import { Bill } from "../models/Bill.js";
import mongoose from "mongoose";
import { Restaurant, RestaurantStatus } from "../models/Restaurant.js";
import { Table } from "../models/Table.js";
import { TableSession, TableSessionStatus } from "../models/TableSession.js";
import { UserRole } from "../models/User.js";
import {
  getCustomerOrderHistory,
  resolveTableSession,
  TableSessionLifecycleError
} from "../services/tableSessionLifecycleService.js";
import {
  expireIdleTableSession,
  expireIdleTableSessionWithinOrderWrite,
  isIdleScanOnlySession
} from "../services/tableSessionExpiryService.js";
import {
  appendOrderToBill,
  resolveActiveBillForSession,
  BillLifecycleError
} from "../services/billLifecycleService.js";
import { emitNewOrder } from "../realtime/socket.js";
import {
  CustomerIdentityError,
  resolveCustomerForOrder
} from "../services/customerIdentityService.js";
import { OwnerRestaurantQuotaLeaseError } from "../services/ownerRestaurantQuotaLeaseService.js";
import { RestaurantNotAcceptingOrdersError, withActiveRestaurantOrderWrite } from "../services/restaurantOrderWriteService.js";
import { AuthRequest, requireAuth, requireRole } from "../middleware/auth.js";
import {
  assertRestaurantOrderChangesAccess,
  getOrderChanges,
  InvalidOrderChangesQueryError,
  OrderChangesAccessError
} from "../services/orderChangesService.js";

const router = Router();

// Reconcile orders missed while a restaurant dashboard socket was disconnected.
router.get("/changes", requireAuth, requireRole([UserRole.RESTAURANT_ADMIN, UserRole.STAFF]), async (req: AuthRequest, res) => {
  const restaurantId = typeof req.query.restaurantId === "string" ? req.query.restaurantId : "";
  const sinceValue = typeof req.query.since === "string" ? req.query.since : "";
  const snapshotValue = typeof req.query.snapshotAt === "string" ? req.query.snapshotAt : undefined;
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const limitValue = typeof req.query.limit === "string" ? req.query.limit : undefined;

  if (!mongoose.isValidObjectId(restaurantId)) {
    return res.status(400).json({ message: "restaurantId không hợp lệ", code: "INVALID_RESTAURANT_ID" });
  }

  const since = new Date(sinceValue);
  const snapshotAt = snapshotValue ? new Date(snapshotValue) : undefined;
  const limit = limitValue === undefined ? 100 : Number(limitValue);
  if (
    !sinceValue || !Number.isFinite(since.getTime()) ||
    (snapshotValue && !Number.isFinite(snapshotAt?.getTime())) ||
    !Number.isInteger(limit) || limit < 1 || limit > 200
  ) {
    return res.status(400).json({ message: "Tham số đồng bộ đơn hàng không hợp lệ", code: "INVALID_ORDER_CHANGES_QUERY" });
  }
  if (Date.now() - since.getTime() > 7 * 24 * 60 * 60 * 1000) {
    return res.status(410).json({ message: "Mốc đồng bộ đã hết hạn; hãy tải lại danh sách hiện tại.", code: "ORDER_CHANGES_CURSOR_EXPIRED" });
  }

  try {
    const restaurant = await Restaurant.findById(restaurantId)
      .select("ownerId archivedAt status active")
      .lean();
    if (!req.auth) return res.status(401).json({ message: "Thiếu thông tin xác thực" });
    assertRestaurantOrderChangesAccess(req.auth, restaurantId, restaurant);

    const result = await getOrderChanges({ restaurantId, since, snapshotAt, cursor, limit });
    res.setHeader("Cache-Control", "no-store");
    return res.json(result);
  } catch (error) {
    if (error instanceof OrderChangesAccessError) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    if (error instanceof InvalidOrderChangesQueryError) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    console.error("Không thể đồng bộ các thay đổi đơn hàng", error);
    return res.status(500).json({ message: "Không thể đồng bộ đơn hàng" });
  }
});

// Khách hàng đặt món (không cần auth)
router.post("/", async (req, res) => {
  const requestStartedAt = performance.now();
  const requestId = typeof res.locals.requestId === "string" ? res.locals.requestId : "untracked";
  const {
    restaurantId,
    tableNumber,
    items,
    note,
    customerName,
    customerPhone,
    marketingConsent,
    consentVersion,
    tableSessionId
  } = req.body as {
    restaurantId?: string;
    tableNumber?: string;
    items?: Array<{ menuItemId: string; name: string; price: number; quantity: number }>;
    note?: string;
    customerName?: string;
    customerPhone?: string;
    marketingConsent?: boolean;
    consentVersion?: string;
    tableSessionId?: string;
  };

  if (!restaurantId || !tableNumber || !items || items.length === 0) {
    return res.status(400).json({ message: "Thiếu thông tin đơn hàng" });
  }

  if (!mongoose.isValidObjectId(restaurantId)) {
    return res.status(400).json({ message: "restaurantId không hợp lệ" });
  }

  const normalizedCustomerName = customerName?.trim();
  if (normalizedCustomerName && (normalizedCustomerName.length < 2 || normalizedCustomerName.length > 100)) {
    return res.status(400).json({ message: "Tên khách hàng phải có từ 2 đến 100 ký tự" });
  }

  if (marketingConsent !== undefined && typeof marketingConsent !== "boolean") {
    return res.status(400).json({ message: "Trạng thái đồng ý chăm sóc khách hàng không hợp lệ" });
  }

  if (consentVersion !== undefined && (typeof consentVersion !== "string" || consentVersion.length > 50)) {
    return res.status(400).json({ message: "Phiên bản nội dung đồng ý không hợp lệ" });
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
  if (!restaurant || restaurant.archivedAt || restaurant.status !== RestaurantStatus.ACTIVE || restaurant.active === false) {
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

    if (isIdleScanOnlySession(session, new Date())) {
      const expired = await expireIdleTableSession({ sessionId: session._id });
      if (expired) {
        return res.status(400).json({
          message: "Phiên bàn đã hết hạn vì chưa có món được gọi. Vui lòng quét lại mã QR."
        });
      }
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

  let customerLink: Awaited<ReturnType<typeof resolveCustomerForOrder>> = {
    customer: null,
    sessionWasLinked: false
  };
  try {
    customerLink = await resolveCustomerForOrder({
      restaurantId,
      session,
      customerName: normalizedCustomerName,
      customerPhone,
      marketingConsent,
      consentVersion
    });
  } catch (error) {
    if (error instanceof CustomerIdentityError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("Không thể liên kết hồ sơ khách hàng với đơn hàng", error);
    return res.status(500).json({ message: "Không thể lưu thông tin khách hàng" });
  }

  // Allow placing multiple orders for the same table (customer ordering multiple rounds)

  let bill: any;
  const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const stageTimings = {
    leaseWaitMs: 0,
    restaurantGateMs: 0,
    writeMs: 0,
    billResolveMs: 0,
    orderInsertMs: 0,
    billAppendMs: 0
  };

  let order: IOrder;
  try {
    order = await withActiveRestaurantOrderWrite(restaurant._id, restaurant.ownerId, async () => {
      const currentSession = await TableSession.findOne({
        _id: session?._id,
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        tableNumber,
        status: { $in: [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_REQUESTED] }
      });

      if (!currentSession) {
        throw new TableSessionLifecycleError(400, "Phiên bàn đã kết thúc. Vui lòng quét lại mã QR.");
      }

      if (isIdleScanOnlySession(currentSession, new Date())) {
        const expired = await expireIdleTableSessionWithinOrderWrite(
          { sessionId: currentSession._id },
          {
            TableSession,
            Table,
            Order,
            Bill,
            withOrderWrite: undefined
          }
        );
        if (expired) {
          throw new TableSessionLifecycleError(
            400,
            "Phiên bàn đã hết hạn vì chưa có món được gọi. Vui lòng quét lại mã QR."
          );
        }
      }

      session = await TableSession.findOne({
        _id: currentSession._id,
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        tableNumber,
        status: { $in: [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_REQUESTED] }
      });
      if (!session) {
        throw new TableSessionLifecycleError(400, "Phiên bàn đã kết thúc. Vui lòng quét lại mã QR.");
      }

      // Bill creation must share the archive lease with the order write. Otherwise
      // a stale session request can create an unpaid bill after archive finalizes.
      let stageStartedAt = performance.now();
      bill = await resolveActiveBillForSession(session);
      stageTimings.billResolveMs = performance.now() - stageStartedAt;
      stageStartedAt = performance.now();
      const createdOrder = await Order.create({
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
        customerName: normalizedCustomerName || undefined,
        sideEffects: {
          status: "pending",
          requestId,
          nextAttemptAt: new Date(Date.now() + 2000),
          notification: { status: "pending", attempts: 0 },
          email: { status: "pending", attempts: 0 },
          customerStats: {
            status: customerLink.customer ? "pending" : "skipped",
            attempts: 0,
            customerId: customerLink.customer?._id,
            sessionWasLinked: customerLink.sessionWasLinked
          }
        }
      });
      stageTimings.orderInsertMs = performance.now() - stageStartedAt;
      stageStartedAt = performance.now();
      bill = await appendOrderToBill(createdOrder, session);
      stageTimings.billAppendMs = performance.now() - stageStartedAt;
      return createdOrder;
    }, timing => Object.assign(stageTimings, timing));
  } catch (error) {
    if (error instanceof RestaurantNotAcceptingOrdersError) {
      return res.status(404).json({ message: "Không tìm thấy nhà hàng đang hoạt động" });
    }
    if (error instanceof OwnerRestaurantQuotaLeaseError) {
      return res.status(503).json({ message: "Nhà hàng đang xử lý thao tác khác. Vui lòng thử lại.", code: "RESTAURANT_BUSY" });
    }
    if (error instanceof TableSessionLifecycleError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (error instanceof BillLifecycleError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("Lỗi khi tạo order trong nhà hàng", error);
    return res.status(500).json({ message: "Không thể lưu đơn hàng" });
  }

  const responseOrder = order.toJSON();
  const emittedAt = new Date().toISOString();
  emitNewOrder(restaurantId, responseOrder, { requestId, emittedAt });
  const realtimeEmitMs = performance.now() - requestStartedAt;
  res.once("finish", () => {
    console.info(JSON.stringify({
      event: "order_create_timing",
      requestId,
      orderId: order._id.toString(),
      restaurantId,
      leaseWaitMs: Number(stageTimings.leaseWaitMs.toFixed(2)),
      restaurantGateMs: Number(stageTimings.restaurantGateMs.toFixed(2)),
      billResolveMs: Number(stageTimings.billResolveMs.toFixed(2)),
      orderInsertMs: Number(stageTimings.orderInsertMs.toFixed(2)),
      billAppendMs: Number(stageTimings.billAppendMs.toFixed(2)),
      writeMs: Number(stageTimings.writeMs.toFixed(2)),
      timeToRealtimeEmitMs: Number(realtimeEmitMs.toFixed(2)),
      responseMs: Number((performance.now() - requestStartedAt).toFixed(2))
    }));
  });
  return res.status(201).json(responseOrder);
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
