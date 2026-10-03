import { Router } from "express";
import mongoose from "mongoose";

import { Ingredient } from "../models/Ingredient.js";
import { MenuItem } from "../models/MenuItem.js";
import { AuthRequest, requireAuth } from "../middleware/auth.js";
import { NutritionService } from "../services/nutritionService.js";
import { resolveAllergenInfoStatusUpdate } from "../services/allergenInfoStatusPolicy.js";
import { resolveMenuAllergenReview } from "../services/menuAllergenReviewService.js";
import { hasVerifiedIngredientAllergenEvidence } from "../services/ingredientAllergenPolicy.js";
import { normalizeAllergenCodes } from "../services/allergenSafetyService.js";
import {
  assertIngredientsAccessible,
  IngredientAccessDeniedError,
  isIngredientAccessible
} from "../services/ingredientAccessService.js";
import {
  isFoodAttributesEnabledForRestaurant,
  serializeMenuItemForFeatures
} from "../services/foodAttributeEntitlementService.js";

const router = Router();

// A REVIEWED menu declaration can only be written through this evidence-backed route.
router.post("/:id/allergen-review", requireAuth, async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId || !["RESTAURANT_OWNER", "RESTAURANT_ADMIN"].includes(req.auth?.role ?? "")) {
    return res.status(403).json({ message: "Chỉ chủ nhà hàng hoặc quản trị viên mới được xác nhận thông tin dị ứng" });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "ID món ăn không hợp lệ" });
  }
  if (!mongoose.isValidObjectId(req.auth?.sub)) {
    return res.status(403).json({ message: "Không xác định được nhân viên xác nhận" });
  }

  const item = await MenuItem.findOne({ _id: req.params.id, restaurantId });
  if (!item) return res.status(404).json({ message: "Không tìm thấy món ăn" });

  let recipeIngredientsReviewed = false;
  let recipeAllergens: string[] | undefined;
  if (req.body?.method === "RECIPE" && item.ingredients.length > 0) {
    try {
      await assertIngredientsAccessible(item.ingredients, restaurantId);
      const ingredientIds = [...new Set(item.ingredients.map((row) => row.ingredientId.toString()))];
      const ingredients = await Ingredient.find({ _id: { $in: ingredientIds } }).lean();
      recipeIngredientsReviewed = ingredients.length === ingredientIds.length
        && ingredients.every((ingredient) => isIngredientAccessible(ingredient, restaurantId)
          && hasVerifiedIngredientAllergenEvidence(ingredient));
      if (recipeIngredientsReviewed) {
        recipeAllergens = normalizeAllergenCodes(ingredients.flatMap((ingredient) => ingredient.allergens));
        if (!recipeAllergens) recipeIngredientsReviewed = false;
      }
    } catch (error) {
      if (error instanceof IngredientAccessDeniedError) {
        return res.status(400).json({ message: "Công thức tham chiếu nguyên liệu không thuộc nhà hàng", code: "RECIPE_NOT_COMPLETE" });
      }
      console.error("Không thể kiểm tra bằng chứng allergen của nguyên liệu trong công thức", error);
      return res.status(500).json({ message: "Không thể xác minh độ bao phủ allergen của công thức" });
    }
  }

  const review = resolveMenuAllergenReview({ ...item.toObject(), recipeIngredientsReviewed, recipeAllergens }, {
    method: req.body?.method,
    containsAllergens: req.body?.containsAllergens,
    mayContainAllergens: req.body?.mayContainAllergens,
    sourceType: req.body?.sourceType,
    sourceNote: req.body?.sourceNote,
    reviewerId: req.auth?.sub ?? "",
    now: new Date()
  });
  if (!review.ok) {
    const messages = {
      INVALID_METHOD: "Chọn cách xác nhận thành phần hợp lệ",
      INVALID_ALLERGENS: "Danh sách allergen có mã không hợp lệ",
      OVERLAPPING_LISTS: "Một allergen không thể đồng thời nằm trong 'có chứa' và 'có thể chứa'",
      INVALID_SOURCE: "Nguồn xác nhận không phù hợp với cách kiểm tra",
      MISSING_EVIDENCE: "Cần ghi nguồn và nội dung đối chiếu trước khi xác nhận",
      RECIPE_NOT_COMPLETE: "Công thức còn thiếu hoặc có nguyên liệu chưa xác minh; hãy bổ sung dữ liệu hoặc dùng khai báo thủ công",
      RECIPE_ALLERGENS_MISSING: "Danh sách “Có chứa” phải bao gồm toàn bộ allergen đã xác minh trong nguyên liệu công thức"
    } as const;
    return res.status(400).json({ message: messages[review.reason], code: review.reason });
  }

  item.reviewedAllergens = review.value.containsAllergens;
  item.mayContainAllergens = review.value.mayContainAllergens;
  item.allergenInfoStatus = "REVIEWED";
  item.allergenReviewMethod = review.value.method;
  item.allergenReviewSourceType = review.value.sourceType;
  item.allergenReviewSourceNote = review.value.sourceNote;
  item.allergenReviewedBy = new mongoose.Types.ObjectId(review.value.reviewerId);
  item.allergenReviewedAt = review.value.reviewedAt;
  await item.save();

  const foodAttributesEnabled = await isFoodAttributesEnabledForRestaurant(restaurantId);
  return res.json(serializeMenuItemForFeatures(item.toObject(), foodAttributesEnabled));
});

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

  if (Array.isArray(ingredients)) {
    try {
      await assertIngredientsAccessible(ingredients, restaurantId);
    } catch (error) {
      if (error instanceof IngredientAccessDeniedError) {
        return res.status(404).json({ message: "Không tìm thấy nguyên liệu" });
      }
      throw error;
    }
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
    ingredients, servingCount, servingSizeGrams, cookingMethod, allergenInfoStatus
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

  const recipeChanged =
    ingredients !== undefined ||
    servingCount !== undefined ||
    cookingMethod !== undefined;
  const allergenReviewInvalidated = recipeChanged || description !== undefined;

  if (allergenReviewInvalidated) {
    update.allergenInfoStatus = "UNKNOWN";
    update.reviewedAllergens = [];
    update.mayContainAllergens = [];
    update.allergenReviewMethod = undefined;
    update.allergenReviewSourceType = undefined;
    update.allergenReviewSourceNote = undefined;
    update.allergenReviewedBy = undefined;
    update.allergenReviewedAt = undefined;
  }
  if (recipeChanged) {
    update.allergens = [];
    update.allergenCoverageStatus = "UNKNOWN";
    update.allergenUnverifiedIngredientCount = 0;
  }

  const allergenStatusUpdate = resolveAllergenInfoStatusUpdate(recipeChanged, allergenInfoStatus);
  if (!allergenStatusUpdate.ok) {
    return res.status(400).json({ message: "Trạng thái xác nhận dị ứng không hợp lệ" });
  }
  if (allergenStatusUpdate.status !== undefined) {
    update.allergenInfoStatus = allergenStatusUpdate.status;
    if (allergenStatusUpdate.status === "UNKNOWN" && !allergenReviewInvalidated) {
      update.reviewedAllergens = [];
      update.mayContainAllergens = [];
      update.allergenReviewMethod = undefined;
      update.allergenReviewSourceType = undefined;
      update.allergenReviewSourceNote = undefined;
      update.allergenReviewedBy = undefined;
      update.allergenReviewedAt = undefined;
    }
  }

  if (Array.isArray(ingredients)) {
    try {
      await assertIngredientsAccessible(ingredients, restaurantId);
    } catch (error) {
      if (error instanceof IngredientAccessDeniedError) {
        return res.status(404).json({ message: "Không tìm thấy nguyên liệu" });
      }
      throw error;
    }
  }

  const item = await MenuItem.findOneAndUpdate(
    { _id: req.params.id, restaurantId },
    update,
    { new: true }
  );

  if (!item) {
    return res.status(404).json({ message: "Không tìm thấy món ăn" });
  }

  // Recalculate only when recipe inputs changed; metadata/status updates preserve the cache.
  if (recipeChanged) {
    try {
      await NutritionService.calculateDishNutrition(item._id);
    } catch (err) {
      console.error("[menuRoutes] Nutrition calculation failed for updated item:", (err as Error).message);
    }
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
