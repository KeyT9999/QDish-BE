import type { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";

import { createSocketCorsOptions } from "../config/cors.js";
import type { AuthPayload } from "../middleware/auth.js";
import { withAuthorizedRestaurantSocketAccess } from "../services/restaurantSocketAccessService.js";

const JWT_SECRET = process.env.JWT_SECRET || "change-me";

let io: Server | null = null;

export const getRestaurantRoom = (restaurantId: string) => `restaurant:${restaurantId}`;
export const getUserRoom = (userId: string) => `user:${userId}`;

export const disconnectRestaurantStaffSockets = async (restaurantId: string) => {
  if (!io) return;

  const room = getRestaurantRoom(restaurantId);
  const sockets = await io.in(room).fetchSockets();
  for (const socket of sockets) {
    const auth = socket.data.auth as AuthPayload | undefined;
    const isAssignedStaff =
      auth?.restaurantId?.toString() === restaurantId &&
      (auth.role === "RESTAURANT_ADMIN" || auth.role === "STAFF");

    if (isAssignedStaff) {
      socket.disconnect(true);
    } else {
      // Owners may subscribe to a selected branch dynamically. Revoke only
      // this branch room so their user-level notification socket stays alive.
      await socket.leave(room);
      socket.emit("restaurant:access-revoked", { restaurantId, reason: "archived" });
    }
  }
};

const getTokenFromSocket = (socket: Socket) => {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.trim();
  }

  const header = socket.handshake.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.substring("Bearer ".length);
  }

  return null;
};

export const initRealtime = (server: HttpServer) => {
  io = new Server(server, {
    cors: createSocketCorsOptions(),
    transports: ["websocket", "polling"]
  });

  io.use(async (socket, next) => {
    const token = getTokenFromSocket(socket);
    if (!token) {
      return next(new Error("Thiếu token realtime"));
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
      // Allow connection with just userId (sub) — Super Admin and Owner may not have restaurantId
      if (!payload.sub) {
        return next(new Error("Token realtime không hợp lệ — thiếu sub"));
      }
      socket.data.auth = payload;
      return next();
    } catch {
      return next(new Error("Token realtime không hợp lệ"));
    }
  });

  io.on("connection", (socket) => {
    const auth = socket.data.auth as AuthPayload | undefined;
    if (!auth?.sub) return;

    const userRoom = getUserRoom(auth.sub);
    let joinedRestaurantId: string | null = null;
    let roomChangeQueue: Promise<void> = Promise.resolve();

    const enqueueRestaurantJoin = (requestedRestaurantId: unknown, acknowledge?: (result: {
      ok: boolean;
      restaurantId?: string;
      code?: string;
      message?: string;
    }) => void) => {
      const restaurantId = typeof requestedRestaurantId === "string"
        ? requestedRestaurantId
        : "";

      roomChangeQueue = roomChangeQueue
        .catch(() => undefined)
        .then(async () => {
          await withAuthorizedRestaurantSocketAccess(auth, restaurantId, async () => {
            if (joinedRestaurantId && joinedRestaurantId !== restaurantId) {
              await socket.leave(getRestaurantRoom(joinedRestaurantId));
            }
            await socket.join(getRestaurantRoom(restaurantId));
            joinedRestaurantId = restaurantId;
          });

          socket.emit("realtime:ready", { restaurantId });
          acknowledge?.({ ok: true, restaurantId });
        })
        .catch((error: any) => {
          const code = typeof error?.code === "string" ? error.code : "SOCKET_JOIN_FAILED";
          const message = typeof error?.message === "string"
            ? error.message
            : "Không thể kết nối realtime tới chi nhánh này.";
          acknowledge?.({ ok: false, restaurantId, code, message });
        });
    };

    // Register before awaiting room access: the client can emit join as soon
    // as the Socket.IO connection is established.
    socket.on("restaurant:join", (payload: unknown, acknowledge?: (result: {
      ok: boolean;
      restaurantId?: string;
      code?: string;
      message?: string;
    }) => void) => {
      const requestedRestaurantId = typeof payload === "string"
        ? payload
        : (payload as { restaurantId?: unknown } | null)?.restaurantId;
      enqueueRestaurantJoin(requestedRestaurantId, acknowledge);
    });

    void (async () => {
      await socket.join(userRoom);
      const isBranchBoundRole = auth.role === "RESTAURANT_ADMIN" || auth.role === "STAFF";
      if (isBranchBoundRole && auth.restaurantId) {
        enqueueRestaurantJoin(auth.restaurantId);
      } else {
        socket.emit("realtime:ready", { userId: auth.sub });
      }
    })().catch(() => {
      socket.disconnect(true);
    });
  });

  return io;
};

// ──────────────────────────────────────────
// Order Events (existing)
// ──────────────────────────────────────────

export const emitNewOrder = (restaurantId: string, order: unknown) => {
  io?.to(getRestaurantRoom(restaurantId)).emit("new-order", order);
};

export const emitOrderUpdated = (restaurantId: string, order: unknown) => {
  io?.to(getRestaurantRoom(restaurantId)).emit("order-updated", order);
};

// ──────────────────────────────────────────
// Notification Events (new)
// ──────────────────────────────────────────

export const emitNotification = (userId: string, notification: unknown) => {
  io?.to(getUserRoom(userId)).emit("notification:new", notification);
};

export const emitUnreadCount = (userId: string, unreadCount: number) => {
  io?.to(getUserRoom(userId)).emit("notification:unread-count", { unreadCount });
};

// ──────────────────────────────────────────
// Table Session Events (new)
// ──────────────────────────────────────────

export const emitTableSessionOpened = (restaurantId: string, session: unknown) => {
  io?.to(getRestaurantRoom(restaurantId)).emit("table-session:opened", session);
};

export const emitTableSessionClosed = (restaurantId: string, session: unknown) => {
  io?.to(getRestaurantRoom(restaurantId)).emit("table-session:closed", session);
};

export const emitTableStatusUpdated = (restaurantId: string, table: unknown) => {
  io?.to(getRestaurantRoom(restaurantId)).emit("table:status-updated", table);
};

export const emitBillPaid = (restaurantId: string, bill: unknown) => {
  io?.to(getRestaurantRoom(restaurantId)).emit("bill:paid", bill);
};
