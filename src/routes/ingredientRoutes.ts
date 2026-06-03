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
    .replace(/đ/g, "d")
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

// GET /api/ingredients (paginated list, requires auth)
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { page, limit, search, category, type } = req.query as {
      page?: string;
      limit?: string;
      search?: string;
      category?: string;
      type?: "all" | "global" | "custom";
    };

    const pageInt = parseInt(page || "1", 10);
    const limitInt = parseInt(limit || "20", 10);
    const userRole = req.auth?.role;
    const restaurantId = req.auth?.restaurantId;

    const filter: any = { isActive: true };

    if (category) {
      filter.category = category;
    }

    if (search && search.trim() !== "") {
      const normalizedSearch = normalizeString(search);
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { slug: { $regex: normalizedSearch, $options: "i" } }
      ];
    }

    if (userRole === "SUPER_ADMIN") {
      if (type === "global") {
        filter.isVerified = true;
      } else if (type === "custom") {
        filter.isVerified = false;
      }
    } else {
      // RESTAURANT_OWNER or RESTAURANT_ADMIN
      if (!restaurantId) {
        return res.status(400).json({ message: "Thiếu thông tin nhà hàng của tài khoản" });
      }
      const tenantId = new mongoose.Types.ObjectId(restaurantId);
      if (type === "global") {
        filter.isVerified = true;
      } else if (type === "custom") {
        filter.isVerified = false;
        filter.restaurantId = tenantId;
      } else {
        // all: global verified OR own custom
        const accessFilter = {
          $or: [
            { isVerified: true },
            { restaurantId: tenantId }
          ]
        };
        if (filter.$or) {
          filter.$and = [
            { $or: filter.$or },
            accessFilter
          ];
          delete filter.$or;
        } else {
          Object.assign(filter, accessFilter);
        }
      }
    }

    const skip = (pageInt - 1) * limitInt;
    const total = await Ingredient.countDocuments(filter);
    const ingredients = await Ingredient.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitInt)
      .lean();

    return res.json({
      ingredients,
      total,
      page: pageInt,
      pages: Math.ceil(total / limitInt)
    });
  } catch (error: any) {
    console.error("Error listing ingredients:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi lấy danh sách nguyên liệu" });
  }
});

// POST /api/ingredients (requires auth, unified create)
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userRole = req.auth?.role;
    const restaurantId = req.auth?.restaurantId;

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

    let isVerified = false;
    let tenantId: mongoose.Types.ObjectId | null = null;
    let source = "merchant";
    let slug = "";

    if (userRole === "SUPER_ADMIN") {
      isVerified = true;
      tenantId = null;
      source = "global";
      slug = `global-${normalizeString(name).replace(/\s+/g, "-")}`;
    } else if (userRole === "RESTAURANT_OWNER" || userRole === "RESTAURANT_ADMIN") {
      if (!restaurantId) {
        return res.status(403).json({ message: "Không tìm thấy thông tin nhà hàng để tạo nguyên liệu tùy chỉnh" });
      }
      isVerified = false;
      tenantId = new mongoose.Types.ObjectId(restaurantId);
      source = "merchant";
      slug = `${restaurantId}-${normalizeString(name).replace(/\s+/g, "-")}`;
    } else {
      return res.status(403).json({ message: "Bạn không có quyền thực hiện chức năng này" });
    }

    // Check unique slug to prevent duplicates
    const existing = await Ingredient.findOne({ slug });
    if (existing) {
      return res.status(400).json({ message: "Nguyên liệu này đã tồn tại trong hệ thống/nhà hàng" });
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
      isVerified,
      restaurantId: tenantId,
      source,
      isActive: true
    });

    // Create default alias mapping
    await IngredientAlias.create({
      ingredientId: ingredient._id,
      alias: name.toLowerCase(),
      aliasNormalized: normalizeString(name),
      language: "vi"
    });

    return res.status(201).json(ingredient);
  } catch (error: any) {
    console.error("Error creating ingredient:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tạo nguyên liệu" });
  }
});

// POST /api/ingredients/custom (legacy compatibility for old calls)
router.post("/custom", requireAuth, async (req: AuthRequest, res) => {
  try {
    const restaurantId = req.auth?.restaurantId;
    if (!restaurantId) {
      return res.status(403).json({ message: "Chỉ admin nhà hàng mới có quyền tạo nguyên liệu tùy chỉnh" });
    }
    const { name, ...rest } = req.body;
    const slug = `${restaurantId}-${normalizeString(name).replace(/\s+/g, "-")}`;
    const existing = await Ingredient.findOne({ slug });
    if (existing) {
      return res.status(400).json({ message: "Nguyên liệu này đã tồn tại trong thực đơn của nhà hàng" });
    }

    const ingredient = await Ingredient.create({
      ...rest,
      name,
      slug,
      isVerified: false,
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      source: "merchant",
      isActive: true
    });

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

// PATCH /api/ingredients/:id (requires auth)
router.patch("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userRole = req.auth?.role;
    const restaurantId = req.auth?.restaurantId;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "ID nguyên liệu không hợp lệ" });
    }

    const ingredient = await Ingredient.findById(id);
    if (!ingredient) {
      return res.status(404).json({ message: "Không tìm thấy nguyên liệu" });
    }

    // Permission checks
    if (userRole === "SUPER_ADMIN") {
      // Super admin can edit anything, but custom remains custom, global remains global
    } else if (userRole === "RESTAURANT_OWNER" || userRole === "RESTAURANT_ADMIN") {
      if (ingredient.isVerified) {
        return res.status(403).json({ message: "Không thể chỉnh sửa nguyên liệu hệ thống" });
      }
      if (ingredient.restaurantId?.toString() !== restaurantId) {
        return res.status(403).json({ message: "Bạn không có quyền chỉnh sửa nguyên liệu của nhà hàng khác" });
      }
    } else {
      return res.status(403).json({ message: "Bạn không có quyền thực hiện chức năng này" });
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

    if (name && name.trim() !== ingredient.name) {
      let slug = "";
      if (ingredient.isVerified) {
        slug = `global-${normalizeString(name).replace(/\s+/g, "-")}`;
      } else {
        slug = `${ingredient.restaurantId}-${normalizeString(name).replace(/\s+/g, "-")}`;
      }
      // Check unique slug
      const existing = await Ingredient.findOne({ slug, _id: { $ne: ingredient._id } });
      if (existing) {
        return res.status(400).json({ message: "Tên nguyên liệu mới bị trùng với nguyên liệu khác" });
      }
      ingredient.name = name;
      ingredient.slug = slug;

      // Update alias
      await IngredientAlias.deleteMany({ ingredientId: ingredient._id });
      await IngredientAlias.create({
        ingredientId: ingredient._id,
        alias: name.toLowerCase(),
        aliasNormalized: normalizeString(name),
        language: "vi"
      });
    }

    if (category !== undefined) ingredient.category = category;
    if (defaultUnit !== undefined) ingredient.defaultUnit = defaultUnit;
    if (gramsPerUnit !== undefined) ingredient.gramsPerUnit = gramsPerUnit;
    if (caloriesPer100g !== undefined) ingredient.caloriesPer100g = caloriesPer100g;
    if (proteinPer100g !== undefined) ingredient.proteinPer100g = proteinPer100g;
    if (carbPer100g !== undefined) ingredient.carbPer100g = carbPer100g;
    if (fatPer100g !== undefined) ingredient.fatPer100g = fatPer100g;
    if (fiberPer100g !== undefined) ingredient.fiberPer100g = fiberPer100g;
    if (sugarPer100g !== undefined) ingredient.sugarPer100g = sugarPer100g;
    if (sodiumPer100g !== undefined) ingredient.sodiumPer100g = sodiumPer100g;
    if (allergens !== undefined) ingredient.allergens = allergens;

    await ingredient.save();

    return res.json(ingredient);
  } catch (error: any) {
    console.error("Error updating ingredient:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi cập nhật nguyên liệu" });
  }
});

// DELETE /api/ingredients/:id (requires auth)
router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userRole = req.auth?.role;
    const restaurantId = req.auth?.restaurantId;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "ID nguyên liệu không hợp lệ" });
    }

    const ingredient = await Ingredient.findById(id);
    if (!ingredient) {
      return res.status(404).json({ message: "Không tìm thấy nguyên liệu" });
    }

    // Permission checks
    if (userRole === "SUPER_ADMIN") {
      // Super admin can delete anything
    } else if (userRole === "RESTAURANT_OWNER" || userRole === "RESTAURANT_ADMIN") {
      if (ingredient.isVerified) {
        return res.status(403).json({ message: "Không thể xóa nguyên liệu hệ thống" });
      }
      if (ingredient.restaurantId?.toString() !== restaurantId) {
        return res.status(403).json({ message: "Bạn không có quyền xóa nguyên liệu của nhà hàng khác" });
      }
    } else {
      return res.status(403).json({ message: "Bạn không có quyền thực hiện chức năng này" });
    }

    await Ingredient.findByIdAndDelete(id);
    await IngredientAlias.deleteMany({ ingredientId: id });

    return res.json({ message: "Đã xóa nguyên liệu thành công" });
  } catch (error: any) {
    console.error("Error deleting ingredient:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi xóa nguyên liệu" });
  }
});

export default router;
