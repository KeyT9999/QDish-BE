import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

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

export const requireAuth = (
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
    next();
  } catch {
    return res.status(401).json({ message: "Token không hợp lệ" });
  }
};

export const requireRole = (roles: string | string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(403).json({ message: "Không đủ quyền truy cập" });
    }
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    if (!allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({ message: "Không đủ quyền truy cập" });
    }
    next();
  };
};


