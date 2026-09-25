import type { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";

import { createSocketCorsOptions } from "../config/cors.js";
import type { AuthPayload } from "../middleware/auth.js";
import { withRestaurantSocketAccess } from "../services/restaurantSocketAccessService.js";

const JWT_SECRET = process.env.JWT_SECRET || "change-me";

let io: Server | null = null;

export const getRestaurantRoom = (restaurantId: string) => `restaurant:${restaurantId}`;
export const getUserRoom = (userId: string) => `user:${userId}`;

export const disconnectRestaurantStaffSockets = async (restaurantId: string) => {
  if (!io) return;

  const sockets = await io.in(getRestaurantRoom(restaurantId)).fetchSockets();
  for (const socket of sockets) {
    const auth = socket.data.auth as AuthPayload | undefined;
    if (
      auth?.restaurantId?.toString() === restaurantId &&
      (auth.role === "RESTAURANT_ADMIN" || auth.role === "STAFF")
    ) {
      socket.disconnect(true);
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

    void withRestaurantSocketAccess(auth, async () => {
      // Join the branch room while holding the same owner lease as archive.
      // An archive that runs next will find and disconnect this socket.
      const userRoom = getUserRoom(auth.sub);
      await socket.join(userRoom);

      const restaurantId = auth.restaurantId;
      if (restaurantId) {
        const room = getRestaurantRoom(restaurantId);
        await socket.join(room);
        socket.emit("realtime:ready", { restaurantId });
      } else {
        socket.emit("realtime:ready", { userId: auth.sub });
      }
      socket.on("restaurant:join", () => {
        if (!restaurantId) return;
        const room = getRestaurantRoom(restaurantId);
        void socket.join(room);
        socket.emit("realtime:ready", { restaurantId });
      });
    }).catch(() => {
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
