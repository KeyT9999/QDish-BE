import { Request, Response, Router } from "express";
import { RecommendationEngine } from "../engines/recommendation/RecommendationEngine.js";
import { parseRecommendationRequest } from "../services/diningProfileValidation.js";
import {
  getPlanLimits,
  resolveOwnerByRestaurant,
} from "../services/subscriptionService.js";

const router = Router();

interface RecommendationRouteDependencies {
  resolveOwnerByRestaurant: typeof resolveOwnerByRestaurant;
  getPlanLimits: typeof getPlanLimits;
  generateRecommendations: typeof RecommendationEngine.generateRecommendations;
}

const defaultRecommendationRouteDependencies: RecommendationRouteDependencies = {
  resolveOwnerByRestaurant,
  getPlanLimits,
  generateRecommendations: RecommendationEngine.generateRecommendations,
};

export const createRecommendationHandler = (
  dependencies: RecommendationRouteDependencies = defaultRecommendationRouteDependencies,
) => async (req: Request, res: Response) => {
  const parsed = parseRecommendationRequest(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ message: "Yêu cầu gợi ý món ăn không hợp lệ." });
  }

  try {
    const { restaurantId, userProfile, context } = parsed.value;
    const ownerId = await dependencies.resolveOwnerByRestaurant(restaurantId);
    if (!ownerId) {
      return res.status(404).json({ message: "Không tìm thấy thông tin nhà hàng hoặc chủ sở hữu." });
    }

    const { plan } = await dependencies.getPlanLimits(ownerId);
    if (!plan || !plan.recommendationEnabled) {
      return res.status(403).json({ message: "Tính năng gợi ý món ăn không khả dụng cho gói dịch vụ của nhà hàng này." });
    }

    const recommendations = await dependencies.generateRecommendations(
      restaurantId,
      userProfile,
      context,
    );

    return res.json(recommendations);
  } catch (error) {
    console.error("Error generating recommendations:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tạo gợi ý món ăn phù hợp." });
  }
};

// POST /api/recommendations - generate dining recommendations for a table customer
router.post("/", createRecommendationHandler());

export default router;
