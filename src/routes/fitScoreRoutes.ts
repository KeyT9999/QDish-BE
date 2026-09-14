import { Request, Response, Router } from "express";
import { DishNutritionProfile } from "../models/DishNutritionProfile.js";
import { FitScoreEngine } from "../engines/fitScore/FitScoreEngine.js";
import { MenuItem } from "../models/MenuItem.js";
import { calculateBatchFitScores } from "../services/batchFitScoreService.js";
import { isValidBatchFitScoreInput } from "../services/diningProfileValidation.js";
import {
  getPlanLimits,
  resolveOwnerByRestaurant,
} from "../services/subscriptionService.js";

const router = Router();

interface BatchFitScoreRouteDependencies {
  resolveOwnerByRestaurant: typeof resolveOwnerByRestaurant;
  getPlanLimits: typeof getPlanLimits;
  calculateBatchFitScores: typeof calculateBatchFitScores;
}

const defaultBatchFitScoreRouteDependencies: BatchFitScoreRouteDependencies = {
  resolveOwnerByRestaurant,
  getPlanLimits,
  calculateBatchFitScores,
};

export const createBatchFitScoreHandler = (
  dependencies: BatchFitScoreRouteDependencies = defaultBatchFitScoreRouteDependencies
) => async (req: Request, res: Response) => {
  if (!isValidBatchFitScoreInput(req.body)) {
    return res.status(400).json({
      error: {
        code: "INVALID_FIT_SCORE_REQUEST",
        message: "Yêu cầu Fit Score không hợp lệ",
      },
    });
  }

  try {
    const ownerId = await dependencies.resolveOwnerByRestaurant(req.body.restaurantId);
    if (!ownerId) {
      return res.status(404).json({ message: "Không tìm thấy thông tin nhà hàng hoặc chủ sở hữu." });
    }

    const { plan } = await dependencies.getPlanLimits(ownerId);
    if (!plan || plan.fitScoreEnabled !== true) {
      return res.status(403).json({
        error: {
          code: "FIT_SCORE_NOT_AVAILABLE",
          message: "Fit Score không khả dụng cho gói dịch vụ này",
        },
      });
    }

    const scores = await dependencies.calculateBatchFitScores(req.body);
    return res.json({ scores });
  } catch (error) {
    console.error("Error calculating batch fit scores:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tính Fit Score." });
  }
};

// This static path must be registered before /:dishId/fit-score.
router.post("/fit-scores", createBatchFitScoreHandler());

// GET /api/dishes/:dishId/fit-score
router.get("/:dishId/fit-score", async (req, res) => {
  try {
    const { dishId } = req.params;
    const dish = await MenuItem.findById(dishId);
    if (!dish) {
      return res.status(404).json({ message: "Không tìm thấy món ăn." });
    }

    const { resolveOwnerByRestaurant, getPlanLimits } = await import("../services/subscriptionService.js");
    const ownerId = await resolveOwnerByRestaurant(dish.restaurantId);
    if (!ownerId) {
      return res.status(404).json({ message: "Không tìm thấy thông tin nhà hàng hoặc chủ sở hữu." });
    }

    const { plan } = await getPlanLimits(ownerId);
    if (!plan || !plan.fitScoreEnabled) {
      return res.status(403).json({ message: "Tính năng Fit Score không khả dụng cho gói dịch vụ của nhà hàng này." });
    }

    const profile = await DishNutritionProfile.findOne({ dishId });
    if (!profile) {
      return res.status(404).json({ message: "Không tìm thấy thông tin dinh dưỡng của món ăn này." });
    }

    return res.json({
      fitScores: profile.fitScores || {},
      bestFitContext: profile.bestFitContext || ""
    });
  } catch (error: any) {
    console.error("Error fetching fit score:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi lấy thông tin fit score." });
  }
});

// POST /api/dishes/:dishId/fit-score
router.post("/:dishId/fit-score", async (req, res) => {
  try {
    const { dishId } = req.params;
    const { userId, context, userProfile: directProfile } = req.body;

    const dish = await MenuItem.findById(dishId);
    if (!dish) {
      return res.status(404).json({ message: "Không tìm thấy món ăn." });
    }

    const { resolveOwnerByRestaurant, getPlanLimits } = await import("../services/subscriptionService.js");
    const ownerId = await resolveOwnerByRestaurant(dish.restaurantId);
    if (!ownerId) {
      return res.status(404).json({ message: "Không tìm thấy thông tin nhà hàng hoặc chủ sở hữu." });
    }

    const { plan } = await getPlanLimits(ownerId);
    if (!plan || !plan.fitScoreEnabled) {
      return res.status(403).json({ message: "Tính năng Fit Score không khả dụng cho gói dịch vụ của nhà hàng này." });
    }

    const profile = await DishNutritionProfile.findOne({ dishId });
    if (!profile) {
      return res.status(404).json({ message: "Không tìm thấy thông tin dinh dưỡng của món ăn." });
    }

    // Construct ComputedNutrition object
    const computedNutrition = {
      calories: profile.calories,
      protein: profile.protein,
      carb: profile.carb,
      fat: profile.fat,
      fiber: profile.fiber || 0,
      sugar: profile.sugar || 0,
      sodium: profile.sodium || 0,
      attributes: profile.attributes || [],
      allergens: profile.allergens || [],
      nutritionConfidence: profile.nutritionConfidence || 1.0
    };

    // Get user dining profile if userId supplied
    let userDiningProfile = directProfile;
    if (userId && !userDiningProfile) {
      try {
        const UserProfileModel = await import("../models/UserDiningProfile.js");
        const userProf = await UserProfileModel.UserDiningProfile.findOne({ userId });
        if (userProf) {
          userDiningProfile = {
            goals: userProf.goals || [],
            allergies: userProf.allergies || [],
            preferences: userProf.dietaryPreferences || []
          };
        }
      } catch (e) {
        // Model doesn't exist yet, fallback
      }
    }

    const fitScores = FitScoreEngine.calculateAllFitScores(
      computedNutrition,
      profile.attributes || [],
      userDiningProfile,
      context
    );

    const bestFit = FitScoreEngine.getBestFitContext(fitScores);

    return res.json({
      fitScores,
      bestFitContext: bestFit.type,
      bestFitLabel: bestFit.label,
      bestFitScore: bestFit.score
    });
  } catch (error: any) {
    console.error("Error calculating custom fit score:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tính toán custom fit score." });
  }
});

export default router;
