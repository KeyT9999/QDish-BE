import { Response, Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth.js";
import {
  MerchantInsightService,
  MerchantInsights
} from "../services/merchantInsightService.js";
import {
  getPlanLimits,
  resolveOwnerByRestaurant
} from "../services/subscriptionService.js";

type InsightScope = "menu" | "customer" | "legacy";

interface InsightPlan {
  personalizedMenuEnabled: boolean;
  customerInsightsEnabled: boolean;
}

interface InsightDependencies {
  resolveOwnerByRestaurant: typeof resolveOwnerByRestaurant;
  getPlanLimits: typeof getPlanLimits;
  getInsights: typeof MerchantInsightService.getInsights;
}

const defaultDependencies: InsightDependencies = {
  resolveOwnerByRestaurant,
  getPlanLimits,
  getInsights: MerchantInsightService.getInsights.bind(MerchantInsightService)
};

const canAccessScope = (scope: InsightScope, plan: InsightPlan): boolean => {
  if (scope === "menu") {
    return plan.personalizedMenuEnabled;
  }
  return plan.customerInsightsEnabled;
};

const selectInsightPayload = (
  scope: InsightScope,
  insights: MerchantInsights
): Partial<MerchantInsights> => {
  if (scope === "menu") {
    return {
      menuCoverage: insights.menuCoverage,
      attributeDistribution: insights.attributeDistribution,
      topDishes: insights.topDishes
    };
  }

  if (scope === "customer") {
    return {
      customerSegments: insights.customerSegments,
      surveyResponseCount: insights.surveyResponseCount,
      gapAnalysis: insights.gapAnalysis,
      peakHours: insights.peakHours
    };
  }

  return insights;
};

export const createMerchantInsightHandler = (
  scope: InsightScope,
  dependencies: InsightDependencies = defaultDependencies
) => async (req: AuthRequest, res: Response) => {
  try {
    let restaurantId = req.auth?.restaurantId;

    if (!restaurantId && req.query.restaurantId) {
      restaurantId = req.query.restaurantId as string;
    }

    if (!restaurantId) {
      return res.status(403).json({
        message: "Không xác định được mã chi nhánh cần lấy báo cáo."
      });
    }

    const ownerId = await dependencies.resolveOwnerByRestaurant(restaurantId);
    if (!ownerId) {
      return res.status(404).json({
        message: "Không tìm thấy thông tin nhà hàng hoặc chủ sở hữu."
      });
    }

    if (
      req.auth?.role === "RESTAURANT_OWNER" &&
      ownerId.toString() !== req.auth?.sub
    ) {
      return res.status(403).json({
        message: "Bạn không có quyền truy cập thông tin của chi nhánh này."
      });
    }

    const { plan } = await dependencies.getPlanLimits(ownerId);
    if (!plan || !canAccessScope(scope, plan)) {
      const requiredPlan = scope === "menu" ? "PLUS" : "PRO";
      return res.status(403).json({
        message: `Tính năng này không khả dụng cho gói dịch vụ của bạn. Vui lòng nâng cấp lên gói ${requiredPlan}.`
      });
    }

    const period = (req.query.period as string) || "all";
    const insights = await dependencies.getInsights(
      restaurantId.toString(),
      period
    );
    return res.json(selectInsightPayload(scope, insights));
  } catch (error) {
    console.error("Error fetching merchant insights:", error);
    return res.status(500).json({
      message: "Lỗi hệ thống khi tải báo cáo phân tích thực đơn."
    });
  }
};

const router = Router();

router.get(
  "/menu-insights",
  requireAuth,
  createMerchantInsightHandler("menu")
);
router.get(
  "/customer-insights",
  requireAuth,
  createMerchantInsightHandler("customer")
);

// Backward-compatible endpoint. It returns the complete payload, so only
// customerInsightsEnabled (PRO) plans may access it.
router.get(
  "/insights",
  requireAuth,
  createMerchantInsightHandler("legacy")
);

export default router;
