import { Router } from "express";
import mongoose from "mongoose";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import type { CategoryTranslationValue, CategoryTranslations } from "../models/MenuTranslation.js";
import { AuthRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { generateCategoryTranslationDraft, InvalidTranslationInputError, InvalidTranslationOutputError } from "../services/menuTranslationService.js";
import { filterApprovedTranslations, markCategoryTranslationsStale, serializeManagedTranslations } from "../services/menuTranslationPolicy.js";

const router = Router();
const restaurantAdminOnly = [requireAuth, requireRole(["RESTAURANT_ADMIN"])];

function parseCategoryTranslationLocale(value: string): "en" | "zhCN" | null {
  if (value === "en") return "en";
  if (value === "zh-CN") return "zhCN";
  return null;
}

function parseCategoryTranslationValue(body: unknown): CategoryTranslationValue | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const payload = body as Record<string, unknown>;
  if (typeof payload.name !== "string" || typeof payload.publish !== "boolean") return null;
  const name = payload.name.trim();
  if (!name || name.length > 200) return null;
  return { name };
}

function serializePublicCategory(category: any) {
  const { translations: _privateTranslations, ...publicCategory } = category;
  const translations = filterApprovedTranslations(category.translations as CategoryTranslations | undefined);
  return Object.keys(translations).length > 0 ? { ...publicCategory, translations } : publicCategory;
}

function serializeManagedCategory(category: any) {
  const { translations: _privateTranslations, ...managementCategory } = category;
  const translations = serializeManagedTranslations(category.translations as CategoryTranslations | undefined);
  return Object.keys(translations).length > 0 ? { ...managementCategory, translations } : managementCategory;
}

function sendTranslationError(res: import("express").Response, error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";

  if (error instanceof InvalidTranslationInputError) {
    return res.status(400).json({ message: "Tên danh mục vượt quá giới hạn cho phép.", code });
  }
  if (code === "XKIRO_NOT_CONFIGURED") {
    return res.status(503).json({ message: "Chức năng AI dịch chưa được cấu hình.", code: "TRANSLATION_PROVIDER_UNAVAILABLE" });
  }
  if (error instanceof InvalidTranslationOutputError) {
    return res.status(502).json({ message: "AI chưa trả về bản dịch hợp lệ. Hãy thử lại.", code });
  }
  return res.status(502).json({ message: "Không thể tạo bản dịch lúc này. Hãy thử lại.", code: "TRANSLATION_PROVIDER_ERROR" });
}

// Lấy danh mục theo restaurantId (public)
router.get("/", async (req, res) => {
  const { restaurantId } = req.query as { restaurantId?: string };
  if (!restaurantId) {
    return res.status(400).json({ message: "Thiếu restaurantId" });
  }

  const categories = await Category.find({ restaurantId }).sort({ name: 1 }).lean();
  res.json(categories.map(serializePublicCategory));
});

// Restaurant management read: includes private translation review state.
router.get("/manage", ...restaurantAdminOnly, async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId || !mongoose.isValidObjectId(restaurantId)) {
    return res.status(403).json({ message: "Không xác định được nhà hàng đang quản lý" });
  }

  const categories = await Category.find({ restaurantId }).sort({ name: 1 }).lean();
  return res.json(categories.map(serializeManagedCategory));
});

// Admin nhà hàng thêm danh mục
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId) {
    return res
      .status(403)
      .json({ message: "Chỉ admin nhà hàng mới được thêm danh mục" });
  }

  const { name } = req.body as { name?: string };
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Thiếu tên danh mục" });
  }

  try {
    const category = await Category.create({
      restaurantId,
      name: name.trim()
    });
    res.status(201).json(category);
  } catch (error) {
    return res
      .status(400)
      .json({ message: "Không thể tạo danh mục (có thể đã tồn tại)", error });
  }
});

// Owner/admin: generate both locale drafts without replacing published category labels.
router.post("/:id/translations/draft", ...restaurantAdminOnly, async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId || !mongoose.isValidObjectId(restaurantId)) {
    return res.status(403).json({ message: "Không xác định được nhà hàng đang quản lý" });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "ID danh mục không hợp lệ" });
  }

  const category = await Category.findOne({ _id: req.params.id, restaurantId });
  if (!category) return res.status(404).json({ message: "Không tìm thấy danh mục" });

  try {
    const draft = await generateCategoryTranslationDraft({ name: category.name });
    const currentTranslations = category.toObject().translations as CategoryTranslations | undefined;
    const generatedAt = new Date();
    category.translations = {
      ...(currentTranslations ?? {}),
      en: { ...(currentTranslations?.en ?? {}), draft: { value: draft.en, generatedAt } },
      zhCN: { ...(currentTranslations?.zhCN ?? {}), draft: { value: draft.zhCN, generatedAt } }
    };
    await category.save();
    return res.json(serializeManagedCategory(category.toObject()));
  } catch (error) {
    return sendTranslationError(res, error);
  }
});

// Owner/admin: edit a category draft or explicitly publish the edited label.
router.patch("/:id/translations/:locale", ...restaurantAdminOnly, async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId || !mongoose.isValidObjectId(restaurantId)) {
    return res.status(403).json({ message: "Không xác định được nhà hàng đang quản lý" });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "ID danh mục không hợp lệ" });
  }
  const locale = parseCategoryTranslationLocale(req.params.locale);
  if (!locale) return res.status(400).json({ message: "Ngôn ngữ bản dịch không hợp lệ" });
  const value = parseCategoryTranslationValue(req.body);
  if (!value) return res.status(400).json({ message: "Tên bản dịch không hợp lệ" });

  const category = await Category.findOne({ _id: req.params.id, restaurantId });
  if (!category) return res.status(404).json({ message: "Không tìm thấy danh mục" });

  const currentTranslations = category.toObject().translations as CategoryTranslations | undefined;
  const updatedTranslations: CategoryTranslations = { ...(currentTranslations ?? {}) };
  const entry = { ...(updatedTranslations[locale] ?? {}) };
  if ((req.body as Record<string, unknown>).publish === true) {
    entry.approved = { value, status: "APPROVED" };
    delete entry.draft;
  } else {
    entry.draft = { value, generatedAt: new Date() };
  }
  updatedTranslations[locale] = entry;
  category.translations = updatedTranslations;
  await category.save();
  return res.json(serializeManagedCategory(category.toObject()));
});

// Admin nhà hàng cập nhật danh mục
router.patch("/:id", requireAuth, async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId) {
    return res
      .status(403)
      .json({ message: "Chỉ admin nhà hàng mới được cập nhật danh mục" });
  }

  const { name } = req.body as { name?: string };
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Thiếu tên danh mục" });
  }

  try {
    const current = await Category.findOne({ _id: req.params.id, restaurantId });
    if (!current) {
      return res.status(404).json({ message: "Không tìm thấy danh mục" });
    }
    const sourceChanged = name.trim() !== current.name;
    const updatedTranslations = sourceChanged
      ? markCategoryTranslationsStale(current.translations)
      : current.translations;
    const updated = await Category.findOneAndUpdate(
      {
        _id: req.params.id,
        restaurantId
      },
      { name: name.trim(), ...(sourceChanged ? { translations: updatedTranslations } : {}) },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: "Không tìm thấy danh mục" });
    }

    // Đồng bộ tên category trong MenuItem
    await MenuItem.updateMany(
      { categoryId: updated._id },
      { category: updated.name }
    );

    res.json(updated);
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Tên danh mục đã tồn tại" });
    }
    return res.status(400).json({ message: "Không thể cập nhật danh mục", error });
  }
});

// Admin nhà hàng xóa danh mục
router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
  const restaurantId = req.auth?.restaurantId;
  if (!restaurantId) {
    return res
      .status(403)
      .json({ message: "Chỉ admin nhà hàng mới được xóa danh mục" });
  }

  const deleted = await Category.findOneAndDelete({
    _id: req.params.id,
    restaurantId
  });

  if (!deleted) {
    return res.status(404).json({ message: "Không tìm thấy danh mục" });
  }

  return res.status(204).send();
});

export default router;


