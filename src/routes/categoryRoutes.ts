import { Router } from "express";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { AuthRequest, requireAuth } from "../middleware/auth.js";

const router = Router();

// Lấy danh mục theo restaurantId (public)
router.get("/", async (req, res) => {
  const { restaurantId } = req.query as { restaurantId?: string };
  if (!restaurantId) {
    return res.status(400).json({ message: "Thiếu restaurantId" });
  }

  const categories = await Category.find({ restaurantId }).sort({ name: 1 }).lean();
  res.json(categories);
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
    const updated = await Category.findOneAndUpdate(
      {
        _id: req.params.id,
        restaurantId
      },
      { name: name.trim() },
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


