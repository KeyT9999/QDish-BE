import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { Restaurant, RestaurantStatus } from "../models/Restaurant.js";
import { User, UserRole } from "../models/User.js";
import { AuthRequest, requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// 1. Tạo nhà hàng mới + tài khoản Admin nhà hàng
router.post("/", requireAuth, requireRole(UserRole.RESTAURANT_OWNER as string), async (req: AuthRequest, res) => {
  try {
    const ownerId = req.auth?.sub;
    if (!ownerId) {
      return res.status(403).json({ message: "Không xác định được thông tin chủ sở hữu" });
    }

    const {
      restaurantName,
      restaurantEmail,
      restaurantPhone,
      address,
      restaurantUsername,
      restaurantPassword,
      confirmRestaurantPassword
    } = req.body;

    // Validation
    if (
      !restaurantName ||
      !restaurantEmail ||
      !restaurantPhone ||
      !address ||
      !restaurantUsername ||
      !restaurantPassword ||
      !confirmRestaurantPassword
    ) {
      return res.status(400).json({
        message: "Vui lòng nhập đầy đủ tất cả thông tin nhà hàng."
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(restaurantEmail.trim())) {
      return res.status(400).json({ message: "Định dạng email không hợp lệ" });
    }

    if (restaurantPassword.length < 6) {
      return res.status(400).json({ message: "Mật khẩu cần tối thiểu 6 ký tự" });
    }

    if (restaurantPassword !== confirmRestaurantPassword) {
      return res.status(400).json({ message: "Xác nhận mật khẩu không khớp" });
    }

    // Check unique username in User collection
    const existingUser = await User.findOne({ username: restaurantUsername.trim() });
    if (existingUser) {
      return res.status(400).json({ message: "Tên đăng nhập tài khoản chi nhánh đã tồn tại trong hệ thống" });
    }

    // Get owner details
    const ownerUser = await User.findById(ownerId);
    const ownerName = ownerUser?.fullName || ownerUser?.username || "Chủ nhà hàng";

    // Create Restaurant
    const restaurant = await Restaurant.create({
      name: restaurantName.trim(),
      username: restaurantUsername.trim(),
      ownerName,
      email: restaurantEmail.trim().toLowerCase(),
      address: address.trim(),
      phone: restaurantPhone.trim(),
      status: RestaurantStatus.ACTIVE,
      active: true,
      ownerId: new mongoose.Types.ObjectId(ownerId)
    });

    // Hash password for Restaurant Admin
    const passwordHash = await bcrypt.hash(restaurantPassword, 10);

    // Create User RESTAURANT_ADMIN
    const adminAccount = await User.create({
      username: restaurantUsername.trim(),
      passwordHash,
      role: UserRole.RESTAURANT_ADMIN,
      restaurantId: restaurant._id,
      isActive: true
    });

    res.status(201).json({
      message: "Tạo nhà hàng và tài khoản quản trị thành công",
      restaurant,
      restaurantAccount: {
        id: adminAccount._id,
        username: adminAccount.username,
        role: adminAccount.role
      }
    });
  } catch (error: any) {
    console.error("Lỗi khi chủ nhà hàng tạo nhà hàng:", error);
    res.status(500).json({ message: "Đã xảy ra lỗi hệ thống khi tạo nhà hàng", error });
  }
});

// 2. Lấy danh sách nhà hàng thuộc sở hữu của Owner
router.get("/", requireAuth, requireRole(UserRole.RESTAURANT_OWNER as string), async (req: AuthRequest, res) => {
  try {
    const ownerId = req.auth?.sub;
    if (!ownerId) {
      return res.status(403).json({ message: "Không xác định được chủ sở hữu" });
    }

    const restaurants = await Restaurant.find({
      ownerId: new mongoose.Types.ObjectId(ownerId)
    }).sort({ createdAt: -1 });

    res.json(restaurants);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách nhà hàng của chủ sở hữu:", error);
    res.status(500).json({ message: "Đã xảy ra lỗi hệ thống khi tải danh sách chi nhánh", error });
  }
});

// 3. Lấy chi tiết chi nhánh thuộc sở hữu của Owner
router.get("/:id", requireAuth, requireRole(UserRole.RESTAURANT_OWNER as string), async (req: AuthRequest, res) => {
  try {
    const ownerId = req.auth?.sub;
    const { id } = req.params;

    if (!ownerId) {
      return res.status(403).json({ message: "Không xác định được chủ sở hữu" });
    }

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Mã nhà hàng không hợp lệ" });
    }

    const restaurant = await Restaurant.findOne({
      _id: id,
      ownerId: new mongoose.Types.ObjectId(ownerId)
    });

    if (!restaurant) {
      return res.status(404).json({ message: "Không tìm thấy chi nhánh hoặc bạn không có quyền truy cập" });
    }

    res.json(restaurant);
  } catch (error) {
    console.error("Lỗi khi lấy thông tin chi tiết nhà hàng:", error);
    res.status(500).json({ message: "Đã xảy ra lỗi hệ thống", error });
  }
});

export default router;
