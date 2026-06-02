import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth.js";
import { MerchantInsightService } from "../services/merchantInsightService.js";

const router = Router();

// GET /api/restaurants/insights - get insights for the current authenticated restaurant
router.get("/insights", requireAuth, async (req: AuthRequest, res) => {
  try {
    const restaurantId = req.auth?.restaurantId;
    if (!restaurantId) {
      return res.status(403).json({ message: "Chỉ admin nhà hàng mới có quyền truy cập báo cáo này." });
    }

    const insights = await MerchantInsightService.getInsights(restaurantId.toString());
    return res.json(insights);
  } catch (error: any) {
    console.error("Error fetching merchant insights:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tải báo cáo phân tích thực đơn." });
  }
});

export default router;
