import { Router } from "express";
import { DishNutritionProfile } from "../models/DishNutritionProfile.js";
import { FitScoreEngine } from "../engines/fitScore/FitScoreEngine.js";
import { MenuItem } from "../models/MenuItem.js";

const router = Router();

// GET /api/dishes/:dishId/fit-score
router.get("/:dishId/fit-score", async (req, res) => {
  try {
    const { dishId } = req.params;
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
