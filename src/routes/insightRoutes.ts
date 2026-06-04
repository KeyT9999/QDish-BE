import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth.js";
import { MerchantInsightService } from "../services/merchantInsightService.js";

const router = Router();

// GET /api/restaurants/insights - get insights for the current authenticated restaurant
router.get("/insights", requireAuth, async (req: AuthRequest, res) => {
  try {
    let restaurantId = req.auth?.restaurantId;
    
    // Nếu là Owner, lấy restaurantId từ query param
    if (!restaurantId && req.query.restaurantId) {
      restaurantId = req.query.restaurantId as string;
    }

    if (!restaurantId) {
      return res.status(403).json({ message: "Không xác định được mã chi nhánh cần lấy báo cáo." });
    }

    const { resolveOwnerByRestaurant, getPlanLimits } = await import("../services/subscriptionService.js");
    const ownerId = await resolveOwnerByRestaurant(restaurantId);
    if (!ownerId) {
      return res.status(404).json({ message: "Không tìm thấy thông tin nhà hàng hoặc chủ sở hữu." });
    }

    // Kiểm tra quyền sở hữu đối với OWNER
    if (req.auth?.role === "RESTAURANT_OWNER" && ownerId.toString() !== req.auth?.sub) {
      return res.status(403).json({ message: "Bạn không có quyền truy cập thông tin của chi nhánh này." });
    }

    const { plan } = await getPlanLimits(ownerId);
    if (!plan || !plan.personalizedMenuEnabled) {
      return res.status(403).json({ message: "Tính năng phân tích dữ liệu thực khách (Customer Insights) không khả dụng cho gói dịch vụ của bạn. Vui lòng nâng cấp lên gói PLUS trở lên." });
    }

    const insights = await MerchantInsightService.getInsights(restaurantId.toString());
    return res.json(insights);
  } catch (error: any) {
    console.error("Error fetching merchant insights:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tải báo cáo phân tích thực đơn." });
  }
});

export default router;
