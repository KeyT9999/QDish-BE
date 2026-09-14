import { Response, Router } from "express";
import mongoose from "mongoose";

import { AuthRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { UserRole } from "../models/User.js";
import { getCustomerDetail, listCustomers } from "../services/customerCrmService.js";
import { canAccessCustomerCrm } from "../services/customerCrmPolicy.js";
import { CustomerIdentityError } from "../services/customerIdentityService.js";
import { getPlanLimits, resolveOwnerByRestaurant } from "../services/subscriptionService.js";

interface CustomerRouteDependencies {
  resolveOwnerByRestaurant: typeof resolveOwnerByRestaurant;
  getPlanLimits: typeof getPlanLimits;
  listCustomers: typeof listCustomers;
  getCustomerDetail: typeof getCustomerDetail;
}

const defaultDependencies: CustomerRouteDependencies = {
  resolveOwnerByRestaurant,
  getPlanLimits,
  listCustomers,
  getCustomerDetail
};

async function authorizeCustomerCrm(
  req: AuthRequest,
  res: Response,
  dependencies: CustomerRouteDependencies
) {
  if (req.auth?.role !== UserRole.RESTAURANT_OWNER || !req.auth.restaurantId) {
    res.status(403).json({ message: "Chỉ chủ nhà hàng được truy cập dữ liệu khách hàng" });
    return null;
  }

  const ownerId = await dependencies.resolveOwnerByRestaurant(req.auth.restaurantId);
  if (!ownerId || ownerId.toString() !== req.auth.sub) {
    res.status(403).json({ message: "Bạn không có quyền truy cập dữ liệu của nhà hàng này" });
    return null;
  }

  const { plan } = await dependencies.getPlanLimits(ownerId);
  if (!canAccessCustomerCrm(plan)) {
    res.status(403).json({ message: "CRM khách hàng chỉ khả dụng cho gói PLUS hoặc PRO" });
    return null;
  }

  return req.auth.restaurantId;
}

const parsePagination = (req: AuthRequest) => ({
  page: Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1),
  limit: Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit || "20"), 10) || 20))
});

export const createCustomerListHandler = (
  dependencies: CustomerRouteDependencies = defaultDependencies
) => async (req: AuthRequest, res: Response) => {
  try {
    const restaurantId = await authorizeCustomerCrm(req, res, dependencies);
    if (!restaurantId) return;
    res.setHeader("Cache-Control", "private, no-store");
    const { page, limit } = parsePagination(req);
    const result = await dependencies.listCustomers({
      restaurantId,
      page,
      limit,
      search: typeof req.query.search === "string" ? req.query.search : undefined
    });
    return res.json(result);
  } catch (error) {
    console.error("Không thể tải danh sách khách hàng", error);
    return res.status(500).json({ message: "Không thể tải danh sách khách hàng" });
  }
};

export const createCustomerDetailHandler = (
  dependencies: CustomerRouteDependencies = defaultDependencies
) => async (req: AuthRequest, res: Response) => {
  try {
    const restaurantId = await authorizeCustomerCrm(req, res, dependencies);
    if (!restaurantId) return;
    res.setHeader("Cache-Control", "private, no-store");
    if (!mongoose.isValidObjectId(req.params.customerId)) {
      return res.status(400).json({ message: "Mã khách hàng không hợp lệ" });
    }
    const { page, limit } = parsePagination(req);
    const result = await dependencies.getCustomerDetail({
      restaurantId,
      customerId: req.params.customerId,
      page,
      limit
    });
    if (!result) return res.status(404).json({ message: "Không tìm thấy khách hàng" });
    return res.json(result);
  } catch (error) {
    if (error instanceof CustomerIdentityError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("Không thể tải lịch sử khách hàng", error);
    return res.status(500).json({ message: "Không thể tải lịch sử khách hàng" });
  }
};

const router = Router();
router.get(
  "/",
  requireAuth,
  requireRole(UserRole.RESTAURANT_OWNER),
  createCustomerListHandler()
);
router.get(
  "/:customerId",
  requireAuth,
  requireRole(UserRole.RESTAURANT_OWNER),
  createCustomerDetailHandler()
);

export default router;
