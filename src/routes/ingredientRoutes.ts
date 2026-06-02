import { Router } from "express";
import mongoose from "mongoose";
import { Ingredient } from "../models/Ingredient.js";
import { IngredientAlias } from "../models/IngredientAlias.js";
import { AuthRequest, requireAuth } from "../middleware/auth.js";

const router = Router();

// Helper to normalize strings (remove Vietnamese accents and punctuation)
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove Vietnamese accents
    .replace(/[^\w\s]/g, ""); // Remove punctuation
}

// GET /api/ingredients/search?q=...&restaurantId=...
router.get("/search", async (req, res) => {
  try {
    const { q, restaurantId } = req.query as { q?: string; restaurantId?: string };

    if (!q || q.trim() === "") {
      return res.json([]);
    }

    const normalizedQuery = normalizeString(q);

    // 1. Search aliases using regex on normalized field
    const aliasMatches = await IngredientAlias.find({
      aliasNormalized: { $regex: normalizedQuery, $options: "i" }
    })
      .limit(30)
      .lean();

    const matchedIngredientIds = aliasMatches.map((a) => a.ingredientId);

    // 2. Build filter for ingredients
    // Return verified global ingredients OR restaurant's custom ingredients
    const tenantFilter: any = {
      isVerified: true,
      isActive: true
    };

    if (restaurantId && mongoose.isValidObjectId(restaurantId)) {
      tenantFilter.isVerified = false;
      tenantFilter.restaurantId = new mongoose.Types.ObjectId(restaurantId);
    }

    const queryFilter = {
      $and: [
        {
          $or: [
            { _id: { $in: matchedIngredientIds } },
            { name: { $regex: q, $options: "i" } },
            { slug: { $regex: normalizedQuery, $options: "i" } }
          ]
        },
        {
          $or: [
            { isVerified: true },
            ...(restaurantId && mongoose.isValidObjectId(restaurantId) ? [{ restaurantId: new mongoose.Types.ObjectId(restaurantId) }] : [])
          ]
        },
        { isActive: true }
      ]
    };

    const results = await Ingredient.find(queryFilter).limit(15).lean();
    return res.json(results);
  } catch (error: any) {
    console.error("Error searching ingredients:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tìm kiếm nguyên liệu" });
  }
});

// POST /api/ingredients/custom
router.post("/custom", requireAuth, async (req: AuthRequest, res) => {
  try {
    const restaurantId = req.auth?.restaurantId;
    if (!restaurantId) {
      return res.status(403).json({ message: "Chỉ admin nhà hàng mới có quyền tạo nguyên liệu tùy chỉnh" });
    }

    const {
      name,
      category,
      defaultUnit,
      gramsPerUnit,
      caloriesPer100g,
      proteinPer100g,
      carbPer100g,
      fatPer100g,
      fiberPer100g,
      sugarPer100g,
      sodiumPer100g,
      allergens
    } = req.body;

    if (!name || !category || !defaultUnit) {
      return res.status(400).json({ message: "Vui lòng nhập đầy đủ tên, danh mục và đơn vị mặc định" });
    }

    const slug = `${restaurantId}-${normalizeString(name).replace(/\s+/g, "-")}`;

    // Check unique slug to prevent duplicates for the same restaurant
    const existing = await Ingredient.findOne({ slug });
    if (existing) {
      return res.status(400).json({ message: "Nguyên liệu này đã tồn tại trong thực đơn của nhà hàng" });
    }

    const ingredient = await Ingredient.create({
      name,
      slug,
      category,
      defaultUnit,
      gramsPerUnit: gramsPerUnit ?? 1,
      caloriesPer100g: caloriesPer100g ?? 0,
      proteinPer100g: proteinPer100g ?? 0,
      carbPer100g: carbPer100g ?? 0,
      fatPer100g: fatPer100g ?? 0,
      fiberPer100g: fiberPer100g ?? 0,
      sugarPer100g: sugarPer100g ?? 0,
      sodiumPer100g: sodiumPer100g ?? 0,
      allergens: allergens ?? [],
      isVerified: false,
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      source: "merchant",
      isActive: true
    });

    // Automatically create alias mapping
    await IngredientAlias.create({
      ingredientId: ingredient._id,
      alias: name.toLowerCase(),
      aliasNormalized: normalizeString(name),
      language: "vi"
    });

    return res.status(201).json(ingredient);
  } catch (error: any) {
    console.error("Error creating custom ingredient:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tạo nguyên liệu tùy chỉnh" });
  }
});

export default router;
