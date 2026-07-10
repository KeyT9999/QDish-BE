import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import multer from "multer";
import { Restaurant, RestaurantStatus } from "../models/Restaurant.js";
import { User, UserRole } from "../models/User.js";
import { AuthRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { Order, OrderStatus } from "../models/Order.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
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
    const existingUser = await User.findOne({ username: restaurantUsername.trim().toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: "Tên đăng nhập tài khoản chi nhánh đã tồn tại trong hệ thống" });
    }

    // Get owner details
    const ownerUser = await User.findById(ownerId);
    const ownerName = ownerUser?.fullName || ownerUser?.username || "Chủ nhà hàng";

    // Create Restaurant
    const restaurant = await Restaurant.create({
      name: restaurantName.trim(),
      username: restaurantUsername.trim().toLowerCase(),
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
      username: restaurantUsername.trim().toLowerCase(),
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

    const { getPlanLimits } = await import("../services/subscriptionService.js");
    let planFeatures = {
      fitScoreEnabled: false,
      foodAttributesEnabled: false,
      recommendationEnabled: false,
      personalizedMenuEnabled: false,
      advancedAnalyticsEnabled: false,
      customerInsightsEnabled: false
    };
    try {
      const { plan } = await getPlanLimits(ownerId);
      planFeatures = {
        fitScoreEnabled: plan.fitScoreEnabled || false,
        foodAttributesEnabled: plan.foodAttributesEnabled || false,
        recommendationEnabled: plan.recommendationEnabled || false,
        personalizedMenuEnabled: plan.personalizedMenuEnabled || false,
        advancedAnalyticsEnabled: plan.advancedAnalyticsEnabled || false,
        customerInsightsEnabled: plan.customerInsightsEnabled || false
      };
    } catch (err) {
      console.error("Lỗi khi tải cấu hình gói của owner:", err);
    }

    const { period = "all" } = req.query as { period?: string };

    // Tính doanh thu và số lượng đơn hàng cho từng nhà hàng
    const restaurantIds = restaurants.map(r => r._id);
    
    const now = new Date();
    let start: Date | undefined;
    let end: Date | undefined = new Date(now);
    end.setHours(23, 59, 59, 999);

    if (period === 'today') {
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
      const dayOfWeek = now.getDay();
      const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Monday
      start = new Date(now.setDate(diff));
      start.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
    } else if (period === 'year') {
      start = new Date(now.getFullYear(), 0, 1);
      start.setHours(0, 0, 0, 0);
    } else {
      start = undefined;
      end = undefined;
    }

    const orderQuery: any = {
      restaurantId: { $in: restaurantIds },
      status: { $in: [OrderStatus.COMPLETED, OrderStatus.SERVED] }
    };
    if (start && end) {
      orderQuery.createdAt = { $gte: start, $lte: end };
    }

    const orders = await Order.find(orderQuery);

    const revenueByRestaurant = new Map<string, number>();
    const orderCountByRestaurant = new Map<string, number>();
    orders.forEach(order => {
      const rId = order.restaurantId.toString();
      revenueByRestaurant.set(rId, (revenueByRestaurant.get(rId) || 0) + order.totalAmount);
      orderCountByRestaurant.set(rId, (orderCountByRestaurant.get(rId) || 0) + 1);
    });

    const restaurantsWithFeatures = restaurants.map(r => {
      const rId = r._id.toString();
      return {
        ...r.toObject(),
        features: planFeatures,
        revenue: revenueByRestaurant.get(rId) || 0,
        orderCount: orderCountByRestaurant.get(rId) || 0
      };
    });

    res.json(restaurantsWithFeatures);
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

// 4. Sao chép thực đơn từ một chi nhánh cũ sang chi nhánh mới
router.post("/:restaurantId/copy-menu", requireAuth, requireRole(UserRole.RESTAURANT_OWNER as string), async (req: AuthRequest, res) => {
  try {
    const ownerId = req.auth?.sub;
    const { restaurantId } = req.params; // Target restaurant
    const { sourceRestaurantId } = req.body; // Source restaurant

    if (!ownerId) {
      return res.status(403).json({ message: "Không xác định được thông tin chủ sở hữu" });
    }

    if (!mongoose.isValidObjectId(restaurantId) || !mongoose.isValidObjectId(sourceRestaurantId)) {
      return res.status(400).json({ message: "Mã nhà hàng không hợp lệ" });
    }

    if (restaurantId === sourceRestaurantId) {
      return res.status(400).json({ message: "Không thể sao chép thực đơn của chính nó" });
    }

    // Verify that both target and source restaurants belong to the owner
    const sourceRest = await Restaurant.findOne({
      _id: sourceRestaurantId,
      ownerId: new mongoose.Types.ObjectId(ownerId)
    });
    const targetRest = await Restaurant.findOne({
      _id: restaurantId,
      ownerId: new mongoose.Types.ObjectId(ownerId)
    });

    if (!sourceRest || !targetRest) {
      return res.status(404).json({
        message: "Không tìm thấy chi nhánh hoặc bạn không có quyền truy cập"
      });
    }

    // 1. Fetch source & target categories
    const sourceCategories = await Category.find({ restaurantId: sourceRestaurantId });
    const targetCategories = await Category.find({ restaurantId: restaurantId });

    // Create a map for Category ID mapping: sourceCategoryId -> targetCategoryId
    const categoryIdMap = new Map<string, string>();

    // 2. Process Categories
    for (const srcCat of sourceCategories) {
      const existingCat = targetCategories.find(
        tc => tc.name.trim().toLowerCase() === srcCat.name.trim().toLowerCase()
      );

      if (existingCat) {
        categoryIdMap.set(srcCat._id.toString(), existingCat._id.toString());
      } else {
        const newCat = await Category.create({
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          name: srcCat.name
        });
        categoryIdMap.set(srcCat._id.toString(), newCat._id.toString());
      }
    }

    // 3. Fetch source menu items
    const sourceMenuItems = await MenuItem.find({ restaurantId: sourceRestaurantId });

    const duplicatedItems = sourceMenuItems.map(item => {
      const itemObj = item.toObject() as any;
      delete itemObj._id;
      delete itemObj.id;
      delete itemObj.createdAt;
      delete itemObj.updatedAt;

      itemObj.restaurantId = new mongoose.Types.ObjectId(restaurantId);
      
      if (itemObj.categoryId) {
        const mappedId = categoryIdMap.get(itemObj.categoryId.toString());
        if (mappedId) {
          itemObj.categoryId = new mongoose.Types.ObjectId(mappedId);
        } else {
          delete itemObj.categoryId;
        }
      }
      
      return itemObj;
    });

    if (duplicatedItems.length > 0) {
      await MenuItem.insertMany(duplicatedItems);
    }

    res.json({
      success: true,
      message: `Đã sao chép thành công ${sourceCategories.length} danh mục và ${duplicatedItems.length} món ăn.`,
      copiedCategories: sourceCategories.length,
      copiedMenuItems: duplicatedItems.length
    });
  } catch (error) {
    console.error("Lỗi khi sao chép thực đơn:", error);
    res.status(500).json({ message: "Đã xảy ra lỗi khi sao chép thực đơn", error });
  }
});

export default router;
