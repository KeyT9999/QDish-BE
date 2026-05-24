import type { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";

import type { AuthPayload } from "../middleware/auth.js";

const JWT_SECRET = process.env.JWT_SECRET || "change-me";

let io: Server | null = null;

export const getRestaurantRoom = (restaurantId: string) => `restaurant:${restaurantId}`;

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
    cors: {
      origin: process.env.APP_BASE_URL || "*",
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  io.use((socket, next) => {
    const token = getTokenFromSocket(socket);
    if (!token) {
      return next(new Error("Thiếu token realtime"));
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
      if (!payload.restaurantId) {
        return next(new Error("Không xác định được nhà hàng realtime"));
      }
      socket.data.auth = payload;
      return next();
    } catch {
      return next(new Error("Token realtime không hợp lệ"));
    }
  });

  io.on("connection", (socket) => {
    const auth = socket.data.auth as AuthPayload | undefined;
    const restaurantId = auth?.restaurantId;
    if (!restaurantId) return;

    const room = getRestaurantRoom(restaurantId);
    socket.join(room);
    socket.emit("realtime:ready", { restaurantId });

    socket.on("restaurant:join", () => {
      socket.join(room);
      socket.emit("realtime:ready", { restaurantId });
    });
  });

  return io;
};

export const emitNewOrder = (restaurantId: string, order: unknown) => {
  io?.to(getRestaurantRoom(restaurantId)).emit("new-order", order);
};

export const emitOrderUpdated = (restaurantId: string, order: unknown) => {
  io?.to(getRestaurantRoom(restaurantId)).emit("order-updated", order);
};
