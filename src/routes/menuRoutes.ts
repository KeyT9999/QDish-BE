import { Router } from "express";
import mongoose from "mongoose";

import { MenuItem } from "../models/MenuItem.js";
import { AuthRequest, requireAuth } from "../middleware/auth.js";

const router = Router();

// Public: lấy menu theo restaurantId (bắt buộc)
router.get("/", async (req, res) => {
  const { restaurantId, includeUnavailable } = req.query as { 
    restaurantId?: string; 
    includeUnavailable?: string;
  };

  if (!restaurantId) {
    return res.status(400).json({ message: "Thiếu restaurantId" });
  }

  if (!mongoose.isValidObjectId(restaurantId)) {
    return res
      .status(400)
      .json({ message: "restaurantId không hợp lệ", restaurantId });
  }

  // Build query filter
  const filter: any = { restaurantId };
  
  // Nếu không có includeUnavailable hoặc là false, chỉ lấy món available
  // (Mặc định cho khách hàng chỉ thấy món available)
  if (!includeUnavailable || includeUnavailable !== 'true') {
    filter.available = true;
  }

  const items = await MenuItem.find(filter).sort({ createdAt: -1 }).lean();
  res.json(items);
});

// Restaurant Admin: thêm món
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId) {
    return res
      .status(403)
      .json({ message: "Chỉ admin nhà hàng mới được thêm món" });
  }

  // Kiểm tra giới hạn số lượng món ăn của gói dịch vụ
  try {
    const { resolveOwnerByRestaurant, checkPlanLimit } = await import("../services/subscriptionService.js");
    const ownerId = await resolveOwnerByRestaurant(restaurantId);
    if (ownerId) {
      const limitError = await checkPlanLimit(ownerId, "MENU_ITEM_LIMIT");
      if (limitError) {
        return res.status(403).json({
          message: limitError.message,
          code: "PLAN_LIMIT_REACHED",
          limitType: "MENU_ITEM_LIMIT",
          currentPlan: limitError.currentPlan,
          upgradeRequired: true
        });
      }
    }
  } catch (err) {
    console.error("Lỗi khi kiểm tra giới hạn món ăn:", err);
  }

  const { 
    name, description, price, category, categoryId, imageUrl, available,
    calories, protein, carbs, fat, fiber, sugar, sodium, nutritionScore,
    allergens, healthTags, healthLabels
  } = req.body;

  if (!name || typeof price !== "number" || !category) {
    return res
      .status(400)
      .json({ message: "Thiếu name/price/category khi thêm món" });
  }

  const item = await MenuItem.create({
    restaurantId,
    name,
    description,
    price,
    category,
    categoryId,
    imageUrl,
    available: available ?? true,
    calories: calories ?? 0,
    protein: protein ?? 0,
    carbs: carbs ?? 0,
    fat: fat ?? 0,
    fiber: fiber ?? 0,
    sugar: sugar ?? 0,
    sodium: sodium ?? 0,
    nutritionScore: nutritionScore ?? 0,
    allergens: allergens ?? [],
    healthTags: healthTags ?? [],
    healthLabels: healthLabels ?? []
  });

  res.status(201).json(item);
});

// Restaurant Admin: sửa món
router.patch("/:id", requireAuth, async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId) {
    return res
      .status(403)
      .json({ message: "Chỉ admin nhà hàng mới được sửa món" });
  }

  const { 
    name, description, price, category, categoryId, imageUrl, available,
    calories, protein, carbs, fat, fiber, sugar, sodium, nutritionScore,
    allergens, healthTags, healthLabels
  } = req.body;

  const update: any = {};
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (price !== undefined) update.price = price;
  if (category !== undefined) update.category = category;
  if (categoryId !== undefined) update.categoryId = categoryId;
  if (imageUrl !== undefined) update.imageUrl = imageUrl;
  if (available !== undefined) update.available = available;
  if (calories !== undefined) update.calories = calories;
  if (protein !== undefined) update.protein = protein;
  if (carbs !== undefined) update.carbs = carbs;
  if (fat !== undefined) update.fat = fat;
  if (fiber !== undefined) update.fiber = fiber;
  if (sugar !== undefined) update.sugar = sugar;
  if (sodium !== undefined) update.sodium = sodium;
  if (nutritionScore !== undefined) update.nutritionScore = nutritionScore;
  if (allergens !== undefined) update.allergens = allergens;
  if (healthTags !== undefined) update.healthTags = healthTags;
  if (healthLabels !== undefined) update.healthLabels = healthLabels;

  const item = await MenuItem.findOneAndUpdate(
    { _id: req.params.id, restaurantId },
    update,
    { new: true }
  );

  if (!item) {
    return res.status(404).json({ message: "Không tìm thấy món ăn" });
  }

  res.json(item);
});

// Restaurant Admin: xóa món
router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId) {
    return res
      .status(403)
      .json({ message: "Chỉ admin nhà hàng mới được xóa món" });
  }

  const item = await MenuItem.findOneAndDelete({
    _id: req.params.id,
    restaurantId
  });

  if (!item) {
    return res.status(404).json({ message: "Không tìm thấy món ăn" });
  }

  res.status(204).send();
});

export default router;
