import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import multer from "multer";
import { Restaurant, RestaurantStatus } from "../models/Restaurant.js";
import { User, UserRole } from "../models/User.js";
import { AuthRequest, requireAuth, requireRole } from "../middleware/auth.js";
import {
  deleteCloudinaryImage,
  isCloudinaryConfigured,
  uploadImageBufferToCloudinary
} from "../services/cloudinaryImageService.js";

const router = Router();

const allowedQrMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const bankQrUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 3 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedQrMimeTypes.has(file.mimetype)) {
      cb(new Error("Chi ho tro anh QR dinh dang jpg, png hoac webp"));
      return;
    }
    cb(null, true);
  }
});

const uploadBankQrImage = bankQrUpload.single("qrImage");

const runBankQrUpload = (req: AuthRequest, res: any) => new Promise<void>((resolve, reject) => {
  uploadBankQrImage(req, res, (error) => {
    if (error) {
      reject(error);
      return;
    }
    resolve();
  });
});

const serializePaymentSettings = (restaurant: any) => ({
  restaurantId: restaurant._id?.toString(),
  bankName: restaurant.bankName || "",
  bankAccountNumber: restaurant.bankAccountNumber || restaurant.bankAccount || "",
  bankAccountHolder: restaurant.bankAccountHolder || restaurant.ownerName || "",
  bankQrImageUrl: restaurant.bankQrImageUrl || "",
  bankQrPublicId: restaurant.bankQrPublicId || "",
  updatedAt: restaurant.paymentSettingsUpdatedAt || restaurant.updatedAt
});

const findOwnedRestaurant = async (ownerId: string | undefined, restaurantId: string) => {
  if (!ownerId) {
    return null;
  }
  if (!mongoose.isValidObjectId(restaurantId)) {
    throw Object.assign(new Error("restaurantId khong hop le"), { statusCode: 400 });
  }
  return Restaurant.findOne({
    _id: restaurantId,
    ownerId: new mongoose.Types.ObjectId(ownerId)
  });
};

// 1. Tạo nhà hàng mới + tài khoản Admin nhà hàng
router.post("/", requireAuth, requireRole(UserRole.RESTAURANT_OWNER as string), async (req: AuthRequest, res) => {
  try {
    const ownerId = req.auth?.sub;
    if (!ownerId) {
      return res.status(403).json({ message: "Không xác định được thông tin chủ sở hữu" });
    }

    // Kiểm tra giới hạn số lượng nhà hàng theo gói
    const { checkPlanLimit } = await import("../services/subscriptionService.js");
    const limitError = await checkPlanLimit(ownerId, "RESTAURANT_LIMIT");
    if (limitError) {
      return res.status(403).json({
        message: limitError.message,
        code: "PLAN_LIMIT_REACHED",
        limitType: "RESTAURANT_LIMIT",
        currentPlan: limitError.currentPlan,
        upgradeRequired: true
      });
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
router.patch("/:restaurantId/payment-settings", requireAuth, requireRole(UserRole.RESTAURANT_OWNER as string), async (req: AuthRequest, res) => {
  try {
    const ownerId = req.auth?.sub;
    const { restaurantId } = req.params;
    const { bankName, bankAccountNumber, bankAccountHolder } = req.body as {
      bankName?: string;
      bankAccountNumber?: string;
      bankAccountHolder?: string;
    };

    const restaurant = await findOwnedRestaurant(ownerId, restaurantId);
    if (!restaurant) {
      return res.status(404).json({ message: "Khong tim thay chi nhanh hoac ban khong co quyen cap nhat" });
    }

    const updates: Record<string, unknown> = {
      paymentSettingsUpdatedByOwnerId: new mongoose.Types.ObjectId(ownerId as string),
      paymentSettingsUpdatedAt: new Date()
    };

    if (bankName !== undefined) updates.bankName = bankName.trim();
    if (bankAccountNumber !== undefined) {
      const normalizedAccount = bankAccountNumber.trim();
      updates.bankAccountNumber = normalizedAccount;
      updates.bankAccount = normalizedAccount;
    }
    if (bankAccountHolder !== undefined) updates.bankAccountHolder = bankAccountHolder.trim();

    const updated = await Restaurant.findByIdAndUpdate(restaurant._id, updates, { new: true });
    return res.json({ settings: serializePaymentSettings(updated) });
  } catch (error: any) {
    return res.status(error?.statusCode || 500).json({
      message: error?.message || "Khong the cap nhat thong tin thanh toan"
    });
  }
});

router.post("/:restaurantId/payment-settings/bank-qr", requireAuth, requireRole(UserRole.RESTAURANT_OWNER as string), async (req: AuthRequest, res) => {
  try {
    await runBankQrUpload(req, res);

    const ownerId = req.auth?.sub;
    const { restaurantId } = req.params;
    const restaurant = await findOwnedRestaurant(ownerId, restaurantId);
    if (!restaurant) {
      return res.status(404).json({ message: "Khong tim thay chi nhanh hoac ban khong co quyen cap nhat" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Thieu file qrImage" });
    }

    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        message: "Backend chua cau hinh Cloudinary. Vui long them CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET."
      });
    }

    const previousPublicId = restaurant.bankQrPublicId;
    const result = await uploadImageBufferToCloudinary(req.file.buffer, "qdish/bank-qr");
    restaurant.bankQrImageUrl = result.secure_url;
    restaurant.bankQrPublicId = result.public_id;
    restaurant.paymentSettingsUpdatedByOwnerId = new mongoose.Types.ObjectId(ownerId as string);
    restaurant.paymentSettingsUpdatedAt = new Date();
    await restaurant.save();

    if (previousPublicId && previousPublicId !== result.public_id) {
      deleteCloudinaryImage(previousPublicId).catch((deleteError) => {
        console.warn("Khong the xoa anh QR cu tren Cloudinary", deleteError);
      });
    }

    return res.status(201).json({
      settings: serializePaymentSettings(restaurant),
      url: result.secure_url,
      publicId: result.public_id
    });
  } catch (error: any) {
    return res.status(error?.statusCode || 400).json({
      message: error?.message || "Khong the upload anh QR chuyen khoan"
    });
  }
});

router.delete("/:restaurantId/payment-settings/bank-qr", requireAuth, requireRole(UserRole.RESTAURANT_OWNER as string), async (req: AuthRequest, res) => {
  try {
    const ownerId = req.auth?.sub;
    const { restaurantId } = req.params;
    const restaurant = await findOwnedRestaurant(ownerId, restaurantId);
    if (!restaurant) {
      return res.status(404).json({ message: "Khong tim thay chi nhanh hoac ban khong co quyen cap nhat" });
    }

    const previousPublicId = restaurant.bankQrPublicId;
    restaurant.bankQrImageUrl = undefined;
    restaurant.bankQrPublicId = undefined;
    restaurant.paymentSettingsUpdatedByOwnerId = new mongoose.Types.ObjectId(ownerId as string);
    restaurant.paymentSettingsUpdatedAt = new Date();
    await restaurant.save();

    if (previousPublicId) {
      deleteCloudinaryImage(previousPublicId).catch((deleteError) => {
        console.warn("Khong the xoa anh QR tren Cloudinary", deleteError);
      });
    }

    return res.json({ settings: serializePaymentSettings(restaurant) });
  } catch (error: any) {
    return res.status(error?.statusCode || 500).json({
      message: error?.message || "Khong the xoa anh QR chuyen khoan"
    });
  }
});

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
