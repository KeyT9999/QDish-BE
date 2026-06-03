import { Router } from "express";
import mongoose from "mongoose";

import { MenuItem } from "../models/MenuItem.js";
import { AuthRequest, requireAuth } from "../middleware/auth.js";
import { NutritionService } from "../services/nutritionService.js";

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
  
  // Map virtual fields for frontend consumption
  const itemsWithNutrition = items.map((item) => ({
    ...item,
    id: item._id,
    nutrition: {
      calories: item.calories ?? 0,
      protein: item.protein ?? 0,
      carbs: item.carbs ?? 0,
      fat: item.fat ?? 0,
      fiber: item.fiber ?? 0,
      sugar: item.sugar ?? 0,
      sodium: item.sodium ?? 0,
      confidenceScore: item.confidenceScore ?? 0
    },
    // Expose attribute / allergen arrays from recipe engine
    foodAttributes: item.foodAttributes ?? [],
    allergens: item.allergens ?? [],
  }));

  res.json(itemsWithNutrition);
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
    ingredients, servingCount, servingSizeGrams, cookingMethod
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
    ingredients: ingredients ?? [],
    servingCount: servingCount ?? 1,
    servingSizeGrams: servingSizeGrams ?? 0,
    cookingMethod: cookingMethod ?? "raw"
  });

  // Calculate and cache nutrition profile
  if (ingredients && ingredients.length > 0) {
    try {
      await NutritionService.calculateDishNutrition(item._id);
    } catch (err) {
      console.error("[menuRoutes] Nutrition calculation failed for new item:", (err as Error).message);
    }
  }

  // Reload item to get updated nutrition cache fields
  const updatedItem = await MenuItem.findById(item._id).lean();
  if (updatedItem) {
    (updatedItem as any).id = updatedItem._id;
    (updatedItem as any).nutrition = {
      calories: updatedItem.calories ?? 0,
      protein: updatedItem.protein ?? 0,
      carbs: updatedItem.carbs ?? 0,
      fat: updatedItem.fat ?? 0,
      fiber: updatedItem.fiber ?? 0,
      sugar: updatedItem.sugar ?? 0,
      sodium: updatedItem.sodium ?? 0,
      confidenceScore: updatedItem.confidenceScore ?? 0
    };
    return res.status(201).json(updatedItem);
  }

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
    ingredients, servingCount, servingSizeGrams, cookingMethod
  } = req.body;

  const update: any = {};
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (price !== undefined) update.price = price;
  if (category !== undefined) update.category = category;
  if (categoryId !== undefined) update.categoryId = categoryId;
  if (imageUrl !== undefined) update.imageUrl = imageUrl;
  if (available !== undefined) update.available = available;
  if (ingredients !== undefined) update.ingredients = ingredients;
  if (servingCount !== undefined) update.servingCount = servingCount;
  if (servingSizeGrams !== undefined) update.servingSizeGrams = servingSizeGrams;
  if (cookingMethod !== undefined) update.cookingMethod = cookingMethod;

  const item = await MenuItem.findOneAndUpdate(
    { _id: req.params.id, restaurantId },
    update,
    { new: true }
  );

  if (!item) {
    return res.status(404).json({ message: "Không tìm thấy món ăn" });
  }

  // Recalculate and update the cache profile
  try {
    await NutritionService.calculateDishNutrition(item._id);
  } catch (err) {
    console.error("[menuRoutes] Nutrition calculation failed for updated item:", (err as Error).message);
  }

  // Reload item to get updated nutrition cache fields
  const updatedItem = await MenuItem.findById(item._id).lean();
  if (updatedItem) {
    (updatedItem as any).id = updatedItem._id;
    (updatedItem as any).nutrition = {
      calories: updatedItem.calories ?? 0,
      protein: updatedItem.protein ?? 0,
      carbs: updatedItem.carbs ?? 0,
      fat: updatedItem.fat ?? 0,
      fiber: updatedItem.fiber ?? 0,
      sugar: updatedItem.sugar ?? 0,
      sodium: updatedItem.sodium ?? 0,
      confidenceScore: updatedItem.confidenceScore ?? 0
    };
    return res.json(updatedItem);
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
