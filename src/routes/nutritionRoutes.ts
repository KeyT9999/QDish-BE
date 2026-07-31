import { Router } from "express";
import { NutritionService } from "../services/nutritionService.js";
import { AuthRequest, requireAuth } from "../middleware/auth.js";
import {
  isFoodAttributesEnabledForRestaurant,
  serializeNutritionPreviewForFeatures
} from "../services/foodAttributeEntitlementService.js";

const router = Router();

// POST /api/nutrition/preview
router.post("/preview", requireAuth, async (req: AuthRequest, res) => {
  try {
    const restaurantId = req.auth?.restaurantId;
    if (!restaurantId) {
      return res.status(403).json({
        message: "Không xác định được nhà hàng cần xem trước dinh dưỡng"
      });
    }

    const { ingredients, servingCount } = req.body;

    if (!ingredients || !Array.isArray(ingredients)) {
      return res.status(400).json({ message: "Thiếu danh sách nguyên liệu của món ăn" });
    }

    const sc = servingCount && Number(servingCount) > 0 ? Number(servingCount) : 1;

    const [preview, foodAttributesEnabled] = await Promise.all([
      NutritionService.calculateNutrition(ingredients, sc),
      isFoodAttributesEnabledForRestaurant(restaurantId)
    ]);
    const responseData = serializeNutritionPreviewForFeatures(
      preview,
      sc,
      foodAttributesEnabled
    );

    return res.json(responseData);
  } catch (error: any) {
    console.error("Error previewing nutrition:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tính toán dữ liệu dinh dưỡng" });
  }
});

export default router;
