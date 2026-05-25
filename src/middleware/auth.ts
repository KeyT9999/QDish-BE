import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Restaurant } from "../models/Restaurant.js";

const JWT_SECRET = process.env.JWT_SECRET || "change-me";

export interface AuthPayload {
  sub: string;
  username?: string;
  role: string;
  restaurantId?: string | null;
}

export interface AuthRequest extends Request {
  auth?: AuthPayload;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Thiếu token" });
  }

  const token = header.substring("Bearer ".length);

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.auth = payload;

    // Nếu người dùng là RESTAURANT_OWNER, phân tích selectedRestaurantId động
    if (payload.role === "RESTAURANT_OWNER") {
      const selectedRestaurantId = 
        req.headers["x-restaurant-id"] || 
        req.query.restaurantId || 
        req.body.restaurantId;

      if (selectedRestaurantId) {
        const restaurant = await Restaurant.findById(selectedRestaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Không tìm thấy nhà hàng được lựa chọn" });
        }

        // Kiểm tra xem Owner có sở hữu nhà hàng này không
        if (restaurant.ownerId?.toString() !== payload.sub) {
          return res.status(403).json({ message: "Bạn không có quyền truy cập nhà hàng này" });
        }

        // Ghi đè restaurantId trong payload để dùng cho các controller/route sau
        req.auth.restaurantId = selectedRestaurantId.toString();
      }
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: "Token không hợp lệ hoặc hết hạn" });
  }
};

export const requireRole = (roles: string | string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(403).json({ message: "Không đủ quyền truy cập" });
    }
    const allowedRoles = [...(Array.isArray(roles) ? roles : [roles])];

    // Tự động gán quyền OWNER cho các tài nguyên của ADMIN
    if (allowedRoles.includes("RESTAURANT_ADMIN") && !allowedRoles.includes("RESTAURANT_OWNER")) {
      allowedRoles.push("RESTAURANT_OWNER");
    }

    if (!allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({ message: "Không đủ quyền truy cập" });
    }
    next();
  };
};
