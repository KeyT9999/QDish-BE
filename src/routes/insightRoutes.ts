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

    const { resolveOwnerByRestaurant, getPlanLimits } = await import("../services/subscriptionService.js");
    const ownerId = await resolveOwnerByRestaurant(restaurantId);
    if (!ownerId) {
      return res.status(404).json({ message: "Không tìm thấy thông tin nhà hàng hoặc chủ sở hữu." });
    }

    const { plan } = await getPlanLimits(ownerId);
    if (!plan || !plan.customerInsightsEnabled) {
      return res.status(403).json({ message: "Tính năng phân tích dữ liệu thực khách (Customer Insights) không khả dụng cho gói dịch vụ của bạn. Vui lòng nâng cấp lên gói PRO." });
    }

    const insights = await MerchantInsightService.getInsights(restaurantId.toString());
    return res.json(insights);
  } catch (error: any) {
    console.error("Error fetching merchant insights:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tải báo cáo phân tích thực đơn." });
  }
});

export default router;
