import { Router } from "express";
import mongoose from "mongoose";
import { Table } from "../models/Table.js";
import { Restaurant } from "../models/Restaurant.js";
import { AuthRequest, requireAuth } from "../middleware/auth.js";

const router = Router();

// Lấy danh sách bàn theo restaurantId (tùy chọn)
router.get("/", async (req, res) => {
  const { restaurantId } = req.query as { restaurantId?: string };

  const filter: any = {};
  if (restaurantId) {
    if (!mongoose.isValidObjectId(restaurantId)) {
      return res
        .status(400)
        .json({ message: "restaurantId không hợp lệ", restaurantId });
    }
    filter.restaurantId = restaurantId;
  }
  const tables = await Table.find(filter).sort({ createdAt: -1 }).lean();
  res.json(tables);
});

// Admin nhà hàng lưu số bàn khi tạo QR
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { code } = req.body as { code?: string };
    const authRestaurantId = req.auth?.restaurantId;

    if (!authRestaurantId) {
      return res
        .status(400)
        .json({ message: "Không xác định được nhà hàng từ token" });
    }

    if (!code) {
      return res.status(400).json({ message: "Thiếu số bàn (code)" });
    }

    const restaurant = await Restaurant.findById(authRestaurantId);
    if (!restaurant) {
      return res.status(404).json({ message: "Nhà hàng không tồn tại" });
    }

    // Kiểm tra giới hạn số bàn ăn của gói dịch vụ
    const existingTable = await Table.findOne({ restaurantId: authRestaurantId, code });
    if (!existingTable) {
      if (restaurant.ownerId) {
        const { checkPlanLimit } = await import("../services/subscriptionService.js");
        const limitError = await checkPlanLimit(restaurant.ownerId, "TABLE_LIMIT");
        if (limitError) {
          return res.status(403).json({
            message: limitError.message,
            code: "PLAN_LIMIT_REACHED",
            limitType: "TABLE_LIMIT",
            currentPlan: limitError.currentPlan,
            upgradeRequired: true
          });
        }
      }
    }

    const table = await Table.findOneAndUpdate(
      { restaurantId: authRestaurantId, code },
      { restaurantId: authRestaurantId, code, isActive: true },
      { new: true, upsert: true }
    );

    return res.status(201).json(table);
  } catch (error) {
    return res
      .status(400)
      .json({ message: "Không thể lưu thông tin bàn", error });
  }
});

export default router;
