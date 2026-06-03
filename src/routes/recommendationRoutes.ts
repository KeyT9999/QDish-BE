import { Router } from "express";
import { RecommendationEngine } from "../engines/recommendation/RecommendationEngine.js";
import { UserDiningProfile } from "../models/UserDiningProfile.js";

const router = Router();

// POST /api/recommendations - generate dining recommendations for a table customer
router.post("/", async (req, res) => {
  try {
    const { restaurantId, userId, context } = req.body;

    if (!restaurantId) {
      return res.status(400).json({ message: "Thiếu restaurantId trong yêu cầu." });
    }

    const { resolveOwnerByRestaurant, getPlanLimits } = await import("../services/subscriptionService.js");
    const ownerId = await resolveOwnerByRestaurant(restaurantId);
    if (!ownerId) {
      return res.status(404).json({ message: "Không tìm thấy thông tin nhà hàng hoặc chủ sở hữu." });
    }

    const { plan } = await getPlanLimits(ownerId);
    if (!plan || !plan.recommendationEnabled) {
      return res.status(403).json({ message: "Tính năng gợi ý món ăn không khả dụng cho gói dịch vụ của nhà hàng này." });
    }

    // Resolve user dining profile details if userId supplied
    let userDiningProfile = undefined;
    if (userId) {
      const profile = await UserDiningProfile.findOne({ userId }).lean();
      if (profile) {
        userDiningProfile = {
          goals: profile.goals || [],
          allergies: profile.allergies || [],
          preferences: profile.dietaryPreferences || []
        };
      }
    }

    const recommendations = await RecommendationEngine.generateRecommendations(
      restaurantId,
      userDiningProfile,
      context
    );

    return res.json(recommendations);
  } catch (error: any) {
    console.error("Error generating recommendations:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tạo gợi ý món ăn phù hợp." });
  }
});

export default router;
