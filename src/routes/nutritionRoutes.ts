import { Router } from "express";
import { NutritionService } from "../services/nutritionService.js";
import { AuthRequest, requireAuth } from "../middleware/auth.js";

const router = Router();

// POST /api/nutrition/preview
router.post("/preview", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { ingredients, servingCount } = req.body;

    if (!ingredients || !Array.isArray(ingredients)) {
      return res.status(400).json({ message: "Thiếu danh sách nguyên liệu của món ăn" });
    }

    const sc = servingCount && Number(servingCount) > 0 ? Number(servingCount) : 1;

    // Trigger preview calculation without saving to DB
    const preview = await NutritionService.calculateNutrition(ingredients, sc);
    
    // Map backend ComputedNutrition to frontend's expected NutritionPreviewResult structure
    const responseData = {
      perServing: {
        calories: preview.calories,
        protein: preview.protein,
        carbs: preview.carb,
        fat: preview.fat,
        fiber: preview.fiber,
        sugar: preview.sugar,
        sodium: preview.sodium
      },
      totalDish: {
        calories: Number((preview.calories * sc).toFixed(1)),
        protein: Number((preview.protein * sc).toFixed(1)),
        carbs: Number((preview.carb * sc).toFixed(1)),
        fat: Number((preview.fat * sc).toFixed(1)),
        fiber: Number((preview.fiber * sc).toFixed(1)),
        sugar: Number((preview.sugar * sc).toFixed(1)),
        sodium: Number((preview.sodium * sc).toFixed(1))
      },
      servingCount: sc,
      attributes: preview.attributes,
      allergens: preview.allergens,
      confidence: preview.nutritionConfidence
    };

    return res.json(responseData);
  } catch (error: any) {
    console.error("Error previewing nutrition:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tính toán dữ liệu dinh dưỡng" });
  }
});

export default router;
