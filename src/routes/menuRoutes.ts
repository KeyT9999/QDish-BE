import { Router } from "express";
import mongoose from "mongoose";

import { Ingredient } from "../models/Ingredient.js";
import { MenuItem } from "../models/MenuItem.js";
import type { MenuItemTranslationValue, MenuItemTranslations } from "../models/MenuTranslation.js";
import { AuthRequest, requireAuth, requireRole } from "../middleware/auth.js";
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
import {
  generateMenuItemTranslationDraft,
  InvalidTranslationInputError,
  InvalidTranslationOutputError
} from "../services/menuTranslationService.js";
import { XkiroTranslationClientError } from "../services/xKiroTranslationClient.js";
import { DeepSeekTranslationClientError } from "../services/deepSeekTranslationClient.js";
import { TranslationProviderFailoverError } from "../services/translationProviderFailover.js";
import {
  filterApprovedTranslations,
  markMenuTranslationsStale,
  serializeManagedTranslations
} from "../services/menuTranslationPolicy.js";

const router = Router();
const restaurantAdminOnly = [requireAuth, requireRole(["RESTAURANT_ADMIN"])];

function serializeManagedMenuItem(item: any, foodAttributesEnabled: boolean) {
  const serialized = serializeMenuItemForFeatures(item, foodAttributesEnabled);
  const { translations: _privateTranslations, ...managementItem } = serialized;
  const translations = serializeManagedTranslations(item.translations as MenuItemTranslations | undefined);
  return Object.keys(translations).length > 0 ? { ...managementItem, translations } : managementItem;
}

function serializePublicMenuItem(item: any, foodAttributesEnabled: boolean) {
  const serialized = serializeMenuItemForFeatures(item, foodAttributesEnabled);
  const { translations: _privateTranslations, ...publicItem } = serialized;
  const translations = filterApprovedTranslations(item.translations as MenuItemTranslations | undefined);
  return Object.keys(translations).length > 0 ? { ...publicItem, translations } : publicItem;
}

export function sendTranslationError(res: import("express").Response, error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";

  if (error instanceof InvalidTranslationInputError) {
    return res.status(400).json({ message: "Tên hoặc mô tả món ăn vượt quá giới hạn cho phép.", code });
  }
  if (code === "XKIRO_NOT_CONFIGURED") {
    return res.status(503).json({ message: "Chức năng AI dịch chưa được cấu hình.", code: "TRANSLATION_PROVIDER_UNAVAILABLE" });
  }
  if (error instanceof InvalidTranslationOutputError) {
    return res.status(502).json({ message: "AI chưa trả về bản dịch hợp lệ. Hãy thử lại.", code });
  }
  if (error instanceof TranslationProviderFailoverError) {
    const providerFailure = (provider: "xkiro" | "deepseek", failure: unknown) => {
      if (failure instanceof XkiroTranslationClientError) {
        return { provider, code: failure.code, upstreamStatus: failure.upstreamStatus };
      }
      if (failure instanceof DeepSeekTranslationClientError) {
        return { provider, code: failure.code, upstreamStatus: failure.upstreamStatus };
      }
      if (failure instanceof InvalidTranslationOutputError) {
        return { provider, code: failure.code };
      }
      return { provider, code: "UNKNOWN_PROVIDER_ERROR" };
    };
    console.error("[menu-translation] primary and fallback providers failed", {
      requestId: res.locals.requestId,
      primary: providerFailure("xkiro", error.primaryError),
      fallback: providerFailure("deepseek", error.fallbackError)
    });
    return res.status(503).json({
      message: "X-Kiro và DeepSeek hiện đều chưa thể dịch. Hãy thử lại sau.",
      code: error.code
    });
  }
  if (error instanceof XkiroTranslationClientError) {
    console.error("[menu-translation] X-Kiro request failed", {
      requestId: res.locals.requestId,
      providerCode: error.code,
      upstreamStatus: error.upstreamStatus,
      retryAfterSeconds: error.retryAfterSeconds
    });

    if (error.code === "XKIRO_TIMEOUT") {
      return res.status(504).json({ message: "Dịch vụ AI phản hồi quá lâu. Hãy thử lại.", code: "TRANSLATION_PROVIDER_TIMEOUT" });
    }
    if (error.code === "XKIRO_UPSTREAM_ERROR" && error.upstreamStatus === 429) {
      if (error.retryAfterSeconds !== undefined) {
        res.setHeader("Retry-After", String(Math.ceil(error.retryAfterSeconds)));
      }
      return res.status(429).json({
        message: "X-Kiro đang giới hạn lượt dịch. Các món còn lại đã tạm dừng; hãy chờ rồi thử lại.",
        code: "TRANSLATION_RATE_LIMITED",
        retryAfterSeconds: error.retryAfterSeconds
      });
    }
    if (error.code === "XKIRO_UPSTREAM_ERROR" && error.upstreamStatus === 402) {
      return res.status(503).json({ message: "Tài khoản X-Kiro đã hết hạn mức sử dụng.", code: "TRANSLATION_PROVIDER_QUOTA" });
    }
    if (error.code === "XKIRO_UPSTREAM_ERROR" && [401, 403, 404].includes(error.upstreamStatus ?? 0)) {
      return res.status(503).json({ message: "Kiểm tra quyền truy cập và model trong cấu hình X-Kiro.", code: "TRANSLATION_PROVIDER_CONFIGURATION" });
    }
    return res.status(503).json({ message: "Dịch vụ AI tạm thời không khả dụng. Hãy thử lại.", code: "TRANSLATION_PROVIDER_UNAVAILABLE" });
  }
  if (error instanceof DeepSeekTranslationClientError) {
    console.error("[menu-translation] DeepSeek request failed", {
      requestId: res.locals.requestId,
      providerCode: error.code,
      upstreamStatus: error.upstreamStatus
    });
    return res.status(503).json({ message: "Dịch vụ dự phòng DeepSeek hiện không khả dụng. Hãy thử lại.", code: "TRANSLATION_PROVIDER_UNAVAILABLE" });
  }
  console.error("[menu-translation] unexpected translation failure", {
    requestId: res.locals.requestId,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorCode: code || undefined
  });
  return res.status(500).json({
    message: "Không thể xử lý bản dịch lúc này. Hãy thử lại.",
    code: "TRANSLATION_DRAFT_FAILED"
  });
}

function parseMenuTranslationLocale(value: string): "en" | "zhCN" | null {
  if (value === "en") return "en";
  if (value === "zh-CN") return "zhCN";
  return null;
}

function parseMenuTranslationValue(body: unknown): MenuItemTranslationValue | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const payload = body as Record<string, unknown>;
  if (typeof payload.name !== "string" || typeof payload.description !== "string") return null;
  const name = payload.name.trim();
  const description = payload.description.trim();
  if (!name || name.length > 200 || description.length > 2000 || typeof payload.publish !== "boolean") return null;
  return { name, description };
}

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

// Restaurant management read: includes unavailable items and private translation review state.
router.get("/manage", ...restaurantAdminOnly, async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId || !mongoose.isValidObjectId(restaurantId)) {
    return res.status(403).json({ message: "Không xác định được nhà hàng đang quản lý" });
  }

  const [items, foodAttributesEnabled] = await Promise.all([
    MenuItem.find({ restaurantId }).sort({ createdAt: -1 }).lean(),
    isFoodAttributesEnabledForRestaurant(restaurantId)
  ]);

  return res.json(items.map((item) => serializeManagedMenuItem(item, foodAttributesEnabled)));
});

// Public: only available items and approved translations are returned.
router.get("/", async (req, res) => {
  const { restaurantId } = req.query as { restaurantId?: string };

  if (!restaurantId) {
    return res.status(400).json({ message: "Thiếu restaurantId" });
  }

  if (!mongoose.isValidObjectId(restaurantId)) {
    return res
      .status(400)
      .json({ message: "restaurantId không hợp lệ", restaurantId });
  }

  const filter = { restaurantId, available: true };

  const [items, foodAttributesEnabled] = await Promise.all([
    MenuItem.find(filter).sort({ createdAt: -1 }).lean(),
    isFoodAttributesEnabledForRestaurant(restaurantId)
  ]);

  const publicItems = items.map((item) =>
    serializePublicMenuItem(item, foodAttributesEnabled)
  );

  res.json(publicItems);
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

// Owner/admin: publish stored drafts after validating the complete selection.
router.post("/translations/bulk-publish", ...restaurantAdminOnly, async (req: AuthRequest, res, next) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId || !mongoose.isValidObjectId(restaurantId)) {
    return res.status(403).json({ message: "Không xác định được nhà hàng đang quản lý" });
  }
  const body = req.body as unknown;
  if (typeof body !== "object" || body === null || Array.isArray(body)
    || Object.keys(body).some((key) => key !== "itemIds")) {
    return res.status(400).json({ message: "Danh sách món ăn không hợp lệ" });
  }
  const { itemIds } = body as { itemIds?: unknown };
  if (!Array.isArray(itemIds) || itemIds.length === 0
    || itemIds.some((id) => typeof id !== "string" || !mongoose.isValidObjectId(id))) {
    return res.status(400).json({ message: "Danh sách ID món ăn không hợp lệ" });
  }
  const normalizedIds = (itemIds as string[]).map((id) => new mongoose.Types.ObjectId(id).toHexString());
  if (new Set(normalizedIds).size !== normalizedIds.length) {
    return res.status(400).json({ message: "Danh sách ID món ăn bị trùng" });
  }

  try {
    const items = await MenuItem.find({ _id: { $in: normalizedIds }, restaurantId });
    if (items.length !== normalizedIds.length) {
      return res.status(404).json({ message: "Không tìm thấy món ăn trong nhà hàng" });
    }
    const updates = items.map((item) => {
      const translations = item.toObject().translations as MenuItemTranslations | undefined;
      const updatedTranslations: MenuItemTranslations = { ...(translations ?? {}) };
      for (const locale of ["en", "zhCN"] as const) {
        const entry = translations?.[locale];
        if (!entry?.draft && entry?.approved?.status !== "APPROVED") return null;
        if (entry?.draft) {
          updatedTranslations[locale] = { approved: { value: entry.draft.value, status: "APPROVED" } };
        }
      }
      return { item, translations: updatedTranslations };
    });
    if (updates.some((update) => update === null)) {
      return res.status(400).json({ message: "Món ăn chưa có đủ bản dịch để xuất bản", code: "INCOMPLETE_TRANSLATIONS" });
    }
    const foodAttributesEnabled = await isFoodAttributesEnabledForRestaurant(restaurantId);
    for (const update of updates) {
      if (!update) continue;
      update.item.translations = update.translations;
      await update.item.save();
    }
    return res.json({
      publishedCount: items.length,
      items: items.map((item) => serializeManagedMenuItem(item.toObject(), foodAttributesEnabled))
    });
  } catch (error) {
    return next(error);
  }
});

// Owner/admin: generate drafts for both supported locales without replacing published text.
router.post("/:id/translations/draft", ...restaurantAdminOnly, async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId || !mongoose.isValidObjectId(restaurantId)) {
    return res.status(403).json({ message: "Không xác định được nhà hàng đang quản lý" });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "ID món ăn không hợp lệ" });
  }

  const preserveExisting = req.body?.preserveExisting;
  if (preserveExisting !== undefined && typeof preserveExisting !== "boolean") {
    return res.status(400).json({ message: "preserveExisting phải là giá trị boolean" });
  }

  const item = await MenuItem.findOne({ _id: req.params.id, restaurantId });
  if (!item) return res.status(404).json({ message: "Không tìm thấy món ăn" });

  let draft: Awaited<ReturnType<typeof generateMenuItemTranslationDraft>>;
  try {
    draft = await generateMenuItemTranslationDraft({
      name: item.name,
      description: item.description ?? "",
      category: item.category
    });
  } catch (error) {
    return sendTranslationError(res, error);
  }

  try {
    const currentTranslations = item.toObject().translations as MenuItemTranslations | undefined;
    const generatedAt = new Date();
    const updatedTranslations: MenuItemTranslations = { ...(currentTranslations ?? {}) };
    for (const locale of ["en", "zhCN"] as const) {
      const entry = currentTranslations?.[locale];
      if (preserveExisting === true && (entry?.draft || entry?.approved?.status === "APPROVED")) continue;
      updatedTranslations[locale] = { ...(entry ?? {}), draft: { value: draft[locale], generatedAt } };
    }
    item.translations = updatedTranslations;
    await item.save();

    const foodAttributesEnabled = await isFoodAttributesEnabledForRestaurant(restaurantId);
    return res.json(serializeManagedMenuItem(item.toObject(), foodAttributesEnabled));
  } catch (error) {
    const errorCode = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;
    console.error("[menu-translation] draft persistence failed", {
      requestId: res.locals.requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode
    });
    return res.status(500).json({
      message: "Không thể lưu bản nháp dịch lúc này. Hãy thử lại.",
      code: "TRANSLATION_DRAFT_FAILED"
    });
  }
});

// Owner/admin: edit a locale draft or explicitly publish the edited value.
router.patch("/:id/translations/:locale", ...restaurantAdminOnly, async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId || !mongoose.isValidObjectId(restaurantId)) {
    return res.status(403).json({ message: "Không xác định được nhà hàng đang quản lý" });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "ID món ăn không hợp lệ" });
  }
  const locale = parseMenuTranslationLocale(req.params.locale);
  if (!locale) return res.status(400).json({ message: "Ngôn ngữ bản dịch không hợp lệ" });
  const value = parseMenuTranslationValue(req.body);
  if (!value) return res.status(400).json({ message: "Tên và mô tả bản dịch không hợp lệ" });

  const item = await MenuItem.findOne({ _id: req.params.id, restaurantId });
  if (!item) return res.status(404).json({ message: "Không tìm thấy món ăn" });

  const currentTranslations = item.toObject().translations as MenuItemTranslations | undefined;
  const updatedTranslations: MenuItemTranslations = { ...(currentTranslations ?? {}) };
  const entry = { ...(updatedTranslations[locale] ?? {}) };
  if ((req.body as Record<string, unknown>).publish === true) {
    entry.approved = { value, status: "APPROVED" };
    delete entry.draft;
  } else {
    entry.draft = { value, generatedAt: new Date() };
  }
  updatedTranslations[locale] = entry;
  item.translations = updatedTranslations;
  await item.save();

  const foodAttributesEnabled = await isFoodAttributesEnabledForRestaurant(restaurantId);
  return res.json(serializeManagedMenuItem(item.toObject(), foodAttributesEnabled));
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

  const sourceTextChanged = name !== undefined || description !== undefined;
  if (sourceTextChanged) {
    const current = await MenuItem.findOne({ _id: req.params.id, restaurantId })
      .select("name description translations");
    if (!current) return res.status(404).json({ message: "Không tìm thấy món ăn" });
    const sourceChanged = (name !== undefined && name !== current.name)
      || (description !== undefined && description !== current.description);
    if (sourceChanged) {
      update.translations = markMenuTranslationsStale(current.translations);
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
