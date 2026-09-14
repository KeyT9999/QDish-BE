import { Router } from "express";
import mongoose from "mongoose";

import { MenuItem } from "../models/MenuItem.js";
import { AuthRequest, requireAuth } from "../middleware/auth.js";
import { NutritionService } from "../services/nutritionService.js";
import {
  isFoodAttributesEnabledForRestaurant,
  serializeMenuItemForFeatures
} from "../services/foodAttributeEntitlementService.js";

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

  const [items, foodAttributesEnabled] = await Promise.all([
    MenuItem.find(filter).sort({ createdAt: -1 }).lean(),
    isFoodAttributesEnabledForRestaurant(restaurantId)
  ]);

  const itemsWithNutrition = items.map((item) =>
    serializeMenuItemForFeatures(item, foodAttributesEnabled)
  );

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

  let resolvedCategoryId = categoryId;
  const trimmedCategoryName = category.trim();

  try {
    const { Category } = await import("../models/Category.js");
    let catDoc = await Category.findOne({
      restaurantId,
      name: { $regex: new RegExp(`^${trimmedCategoryName}$`, "i") }
    });
    if (!catDoc) {
      catDoc = await Category.create({
        restaurantId,
        name: trimmedCategoryName
      });
    }
    resolvedCategoryId = catDoc._id;
  } catch (catErr) {
    console.error("Lỗi khi đồng bộ danh mục:", catErr);
  }

  const item = await MenuItem.create({
    restaurantId,
    name,
    description,
    price,
    category: trimmedCategoryName,
    categoryId: resolvedCategoryId,
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
  const foodAttributesEnabled = await isFoodAttributesEnabledForRestaurant(
    restaurantId
  );
  const responseItem = updatedItem ?? item.toObject();

  return res.status(201).json(
    serializeMenuItemForFeatures(responseItem, foodAttributesEnabled)
  );
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
  
  if (category !== undefined) {
    const trimmedCategoryName = category.trim();
    try {
      const { Category } = await import("../models/Category.js");
      let catDoc = await Category.findOne({
        restaurantId,
        name: { $regex: new RegExp(`^${trimmedCategoryName}$`, "i") }
      });
      if (!catDoc) {
        catDoc = await Category.create({
          restaurantId,
          name: trimmedCategoryName
        });
      }
      update.category = trimmedCategoryName;
      update.categoryId = catDoc._id;
    } catch (catErr) {
      console.error("Lỗi khi đồng bộ danh mục:", catErr);
      update.category = trimmedCategoryName;
    }
  } else if (categoryId !== undefined) {
    update.categoryId = categoryId;
  }

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
  const foodAttributesEnabled = await isFoodAttributesEnabledForRestaurant(
    restaurantId
  );
  const responseItem = updatedItem ?? item.toObject();

  return res.json(
    serializeMenuItemForFeatures(responseItem, foodAttributesEnabled)
  );
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
