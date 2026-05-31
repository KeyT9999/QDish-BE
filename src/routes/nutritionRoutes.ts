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
    return res.json(preview);
  } catch (error: any) {
    console.error("Error previewing nutrition:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tính toán dữ liệu dinh dưỡng" });
  }
});

export default router;
