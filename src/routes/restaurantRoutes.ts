import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { Restaurant, RestaurantStatus } from "../models/Restaurant.js";
import { User, UserRole } from "../models/User.js";
import { AuthRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { sendNewRestaurantWelcomeEmail, sendEmailChangeOTP, sendBankAccountChangeOTP } from "../services/emailService.js";
import { EmailChangeToken } from "../models/EmailChangeToken.js";
import { BankAccountChangeToken } from "../models/BankAccountChangeToken.js";
import { Order, OrderStatus } from "../models/Order.js";
import { MenuItem } from "../models/MenuItem.js";
import fetch from "node-fetch";

const router = Router();
const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  "http://localhost:5173";

const serializePaymentSettings = (restaurant: any) => ({
  restaurantId: restaurant._id?.toString(),
  bankName: restaurant.bankName || "",
  bankAccountNumber: restaurant.bankAccountNumber || restaurant.bankAccount || "",
  bankAccountHolder: restaurant.bankAccountHolder || restaurant.ownerName || "",
  bankQrImageUrl: restaurant.bankQrImageUrl || "",
  updatedAt: restaurant.paymentSettingsUpdatedAt || restaurant.updatedAt
});

// Thống kê tổng quan
router.get("/stats/overview", requireAuth, requireRole(UserRole.SUPER_ADMIN), async (_req, res) => {
  try {
    const restaurants = await Restaurant.find();
    const activeCount = restaurants.filter(r => r.status === RestaurantStatus.ACTIVE).length;
    const inactiveCount = restaurants.filter(r => r.status === RestaurantStatus.INACTIVE).length;

    // Tính doanh thu cho từng nhà hàng (tất cả thời gian)
    const restaurantIds = restaurants.map(r => r._id);
    const orders = await Order.find({
      restaurantId: { $in: restaurantIds },
      status: { $in: [OrderStatus.COMPLETED, OrderStatus.SERVED] }
    });

    // Group theo restaurantId và tính tổng doanh thu
    const revenueByRestaurant = new Map<string, number>();
    orders.forEach(order => {
      const restaurantId = order.restaurantId.toString();
      const current = revenueByRestaurant.get(restaurantId) || 0;
      revenueByRestaurant.set(restaurantId, current + order.totalAmount);
    });

    // Tạo danh sách nhà hàng với doanh thu
    const restaurantsWithRevenue = restaurants.map(r => ({
      id: r._id.toString(),
      name: r.name,
      revenue: revenueByRestaurant.get(r._id.toString()) || 0
    }));

    // Sắp xếp theo doanh thu giảm dần và lấy top 5
    const top5Restaurants = restaurantsWithRevenue
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    res.json({
      totalActive: activeCount,
      totalInactive: inactiveCount,
      top5Restaurants: top5Restaurants
    });
  } catch (error) {
    res.status(500).json({ message: "Không thể lấy thống kê tổng quan", error });
  }
});

// Thống kê doanh thu nhà hàng
router.get("/public/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "restaurantId không hợp lệ" });
    }

    const restaurant = await Restaurant.findById(id)
      .select("_id id name address phone status active bankAccount bankName");

    if (!restaurant || restaurant.status !== RestaurantStatus.ACTIVE || restaurant.active === false) {
      return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
    }

    res.json(restaurant);
  } catch (error) {
    res.status(500).json({ message: "Không thể lấy thông tin nhà hàng", error });
  }
});

router.get(
  "/:restaurantId/payment-settings",
  requireAuth,
  requireRole([UserRole.RESTAURANT_OWNER, UserRole.RESTAURANT_ADMIN, UserRole.STAFF, UserRole.SUPER_ADMIN] as string[]),
  async (req: AuthRequest, res) => {
    try {
      const { restaurantId } = req.params;
      const role = req.auth?.role;

      if (!mongoose.isValidObjectId(restaurantId)) {
        return res.status(400).json({ message: "restaurantId khong hop le" });
      }

      const restaurant = await Restaurant.findById(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ message: "Khong tim thay nha hang" });
      }

      if (role === UserRole.RESTAURANT_OWNER) {
        if (restaurant.ownerId?.toString() !== req.auth?.sub) {
          return res.status(403).json({ message: "Ban khong co quyen xem cau hinh thanh toan cua nha hang nay" });
        }
      } else if (role !== UserRole.SUPER_ADMIN) {
        if (!req.auth?.restaurantId || req.auth.restaurantId !== restaurantId) {
          return res.status(403).json({ message: "Ban khong co quyen xem cau hinh thanh toan cua nha hang nay" });
        }
      }

      return res.json({ settings: serializePaymentSettings(restaurant) });
    } catch (error) {
      return res.status(500).json({ message: "Khong the lay cau hinh thanh toan", error });
    }
  }
);

router.get("/:id/stats/revenue", requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "restaurantId không hợp lệ" });
    }

    const restaurant = await Restaurant.findById(id);
    if (!restaurant) {
      return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
    }

    // Xây dựng query filter
    const query: any = {
      restaurantId: new mongoose.Types.ObjectId(id),
      status: { $in: [OrderStatus.COMPLETED, OrderStatus.SERVED] }
    };

    // Thêm filter thời gian nếu có
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999); // End of day
        query.createdAt.$lte = end;
      }
    }

    const orders = await Order.find(query).sort({ createdAt: 1 });

    // Tính tổng doanh thu và số đơn hàng
    const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
    const totalOrders = orders.length;

    // Group theo ngày để vẽ chart
    const revenueByDate = new Map<string, number>();
    orders.forEach(order => {
      const createdAt = order.createdAt || new Date(); // Fallback nếu không có createdAt
      const dateKey = createdAt.toISOString().split('T')[0]; // YYYY-MM-DD
      const current = revenueByDate.get(dateKey) || 0;
      revenueByDate.set(dateKey, current + order.totalAmount);
    });

    // Chuyển thành array cho chart
    const chartData = Array.from(revenueByDate.entries())
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      restaurantId: id,
      restaurantName: restaurant.name,
      totalRevenue,
      totalOrders,
      chartData
    });
  } catch (error) {
    res.status(500).json({ message: "Không thể lấy thống kê doanh thu", error });
  }
});

// Lấy danh sách nhà hàng với tìm kiếm, lọc, sắp xếp
router.get("/", requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res) => {
  try {
    const { search, status, sortBy, sortOrder } = req.query as {
      search?: string;
      status?: string;
      sortBy?: string;
      sortOrder?: string;
    };

    // Xây dựng query filter
    const filter: any = {};

    // Filter theo trạng thái
    if (status && status !== "ALL") {
      if (status === RestaurantStatus.ACTIVE || status === RestaurantStatus.INACTIVE) {
        filter.status = status;
      }
    }

    // Tìm kiếm theo tên, email, địa chỉ
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), "i");
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { address: searchRegex }
      ];
    }

    // Xây dựng sort
    let sort: any = { createdAt: -1 }; // Default: mới nhất trước
    if (sortBy) {
      const order = sortOrder === "asc" ? 1 : -1;
      if (sortBy === "createdAt") {
        sort = { createdAt: order };
      } else if (sortBy === "name") {
        sort = { name: order };
      } else if (sortBy === "status") {
        sort = { status: order };
      }
    }

    const restaurants = await Restaurant.find(filter).sort(sort);
    res.json(restaurants);
  } catch (error) {
    res.status(500).json({ message: "Không thể lấy danh sách nhà hàng", error });
  }
});

// Tạo nhà hàng mới + tài khoản admin nhà hàng
router.post("/", requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res) => {
  try {
    const {
      name,
      username,
      password,
      ownerName,
      email,
      address,
      phone,
      status
    } = req.body;

    if (
      !name ||
      !username ||
      !password ||
      !ownerName ||
      !email ||
      !address ||
      !phone ||
      !status
    ) {
      return res.status(400).json({
        message:
          "Thiếu thông tin bắt buộc (name, username, password, ownerName, email, address, phone, status)."
      });
    }

    if (!Object.values(RestaurantStatus).includes(status as RestaurantStatus)) {
      return res.status(400).json({ message: "Trạng thái nhà hàng không hợp lệ" });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: "Username đã tồn tại" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingEmailRestaurant = await Restaurant.findOne({
      email: normalizedEmail
    });
    if (existingEmailRestaurant) {
      return res.status(400).json({ message: "Email nhà hàng đã tồn tại" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const normalizedStatus =
      status === RestaurantStatus.INACTIVE ? RestaurantStatus.INACTIVE : RestaurantStatus.ACTIVE;

    const restaurant = await Restaurant.create({
      name,
      username,
      ownerName,
      email: normalizedEmail,
      address,
      phone,
      status: normalizedStatus,
      active: normalizedStatus === RestaurantStatus.ACTIVE
    });

    await User.create({
      username,
      passwordHash,
      role: UserRole.RESTAURANT_ADMIN,
      restaurantId: restaurant._id
    });

    try {
      await sendNewRestaurantWelcomeEmail({
        to: normalizedEmail,
        restaurantName: name,
        ownerName,
        username,
        password,
        dashboardUrl: APP_BASE_URL
      });
    } catch (mailError) {
      console.error("Không thể gửi email chào mừng nhà hàng mới", mailError);
    }

    res.status(201).json(restaurant);
  } catch (error) {
    res.status(400).json({ message: "Không thể tạo nhà hàng", error });
  }
});

// Restaurant Admin yêu cầu gửi OTP để đổi email
router.post(
  "/me/request-email-change",
  requireAuth,
  requireRole([UserRole.RESTAURANT_ADMIN] as string[]),
  async (req: AuthRequest, res) => {
    try {
      const restaurantId = req.auth?.restaurantId;
      if (!restaurantId) {
        return res.status(403).json({ message: "Không xác định được nhà hàng" });
      }

      const { newEmail } = req.body as { newEmail?: string };
      if (!newEmail) {
        return res.status(400).json({ message: "Thiếu email mới" });
      }

      const normalizedNewEmail = newEmail.trim().toLowerCase();

      // Kiểm tra email mới có trùng với nhà hàng khác không
      const existingRestaurant = await Restaurant.findOne({
        email: normalizedNewEmail,
        _id: { $ne: restaurantId }
      });
      if (existingRestaurant) {
        return res.status(400).json({ message: "Email đã được sử dụng bởi nhà hàng khác" });
      }

      // Lấy thông tin restaurant hiện tại
      const restaurant = await Restaurant.findById(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
      }

      // Kiểm tra email mới có khác email cũ không
      if (restaurant.email.toLowerCase() === normalizedNewEmail) {
        return res.status(400).json({ message: "Email mới phải khác email hiện tại" });
      }

      // Tạo OTP 6 chữ số
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Lưu OTP vào database (hết hạn sau 15 phút)
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);

      // Xóa các OTP cũ chưa dùng của restaurant này
      await EmailChangeToken.deleteMany({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        used: false
      });

      await EmailChangeToken.create({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        newEmail: normalizedNewEmail,
        otp,
        expiresAt,
        used: false
      });

      // Gửi email chứa OTP đến email hiện tại
      try {
        await sendEmailChangeOTP({
          to: restaurant.email,
          restaurantName: restaurant.name,
          ownerName: restaurant.ownerName,
          otp,
          newEmail: normalizedNewEmail
        });
      } catch (mailError) {
        console.error("Không thể gửi email OTP đổi email", mailError);
        return res.status(500).json({
          message: "Không thể gửi email OTP. Vui lòng thử lại sau."
        });
      }

      return res.json({
        message: "Đã gửi mã OTP đến email hiện tại của nhà hàng"
      });
    } catch (error) {
      console.error("Lỗi khi xử lý yêu cầu đổi email", error);
      return res.status(500).json({
        message: "Không thể xử lý yêu cầu đổi email"
      });
    }
  }
);

// Restaurant Admin yêu cầu gửi OTP để đổi tài khoản ngân hàng
router.post(
  "/me/request-bank-change",
  requireAuth,
  requireRole([UserRole.RESTAURANT_ADMIN] as string[]),
  async (req: AuthRequest, res) => {
    try {
      const restaurantId = req.auth?.restaurantId;
      if (!restaurantId) {
        return res.status(403).json({ message: "Không xác định được nhà hàng" });
      }

      const { newBankAccount, newBankName } = req.body as { newBankAccount?: string; newBankName?: string };
      if (!newBankAccount || !newBankName) {
        return res.status(400).json({ message: "Thiếu thông tin tài khoản ngân hàng mới" });
      }

      const normalizedBankAccount = newBankAccount.trim();
      const normalizedBankName = newBankName.trim();

      // Lấy thông tin restaurant hiện tại
      const restaurant = await Restaurant.findById(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
      }

      // Kiểm tra tài khoản ngân hàng mới có khác tài khoản cũ không
      if (
        restaurant.bankAccount?.trim() === normalizedBankAccount &&
        restaurant.bankName?.trim() === normalizedBankName
      ) {
        return res.status(400).json({ message: "Tài khoản ngân hàng mới phải khác tài khoản hiện tại" });
      }

      // Tạo OTP 6 chữ số
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Lưu OTP vào database (hết hạn sau 15 phút)
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);

      // Xóa các OTP cũ chưa dùng của restaurant này
      await BankAccountChangeToken.deleteMany({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        used: false
      });

      await BankAccountChangeToken.create({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        newBankAccount: normalizedBankAccount,
        newBankName: normalizedBankName,
        otp,
        expiresAt,
        used: false
      });

      // Gửi email chứa OTP đến email hiện tại
      try {
        await sendBankAccountChangeOTP({
          to: restaurant.email,
          restaurantName: restaurant.name,
          ownerName: restaurant.ownerName,
          otp,
          newBankAccount: normalizedBankAccount,
          newBankName: normalizedBankName
        });
      } catch (mailError) {
        console.error("Không thể gửi email OTP đổi tài khoản ngân hàng", mailError);
        return res.status(500).json({
          message: "Không thể gửi email OTP. Vui lòng thử lại sau."
        });
      }

      return res.json({
        message: "Đã gửi mã OTP đến email hiện tại của nhà hàng"
      });
    } catch (error) {
      console.error("Lỗi khi xử lý yêu cầu đổi tài khoản ngân hàng", error);
      return res.status(500).json({
        message: "Không thể xử lý yêu cầu đổi tài khoản ngân hàng"
      });
    }
  }
);

// Restaurant Admin lấy thông tin nhà hàng của mình
router.get(
  "/me",
  requireAuth,
  requireRole([UserRole.RESTAURANT_ADMIN, UserRole.STAFF] as string[]),
  async (req: AuthRequest, res) => {
    try {
      const restaurantId = req.auth?.restaurantId;
      if (!restaurantId) {
        return res.status(403).json({ message: "Không xác định được nhà hàng" });
      }
      const restaurant = await Restaurant.findById(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
      }
      res.json(restaurant);
    } catch (error) {
      res.status(500).json({ message: "Không thể lấy thông tin nhà hàng", error });
    }
  }
);

// Restaurant Admin cập nhật thông tin nhà hàng của mình
router.patch(
  "/me",
  requireAuth,
  requireRole([UserRole.RESTAURANT_ADMIN] as string[]),
  async (req: AuthRequest, res) => {
    try {
      const restaurantId = req.auth?.restaurantId;
      if (!restaurantId) {
        return res.status(403).json({ message: "Không xác định được nhà hàng" });
      }

      const { name, ownerName, email, address, phone, emailChangeOtp, bankAccount, bankName, bankChangeOtp } = req.body as {
        name?: string;
        ownerName?: string;
        email?: string;
        address?: string;
        phone?: string;
        emailChangeOtp?: string;
        bankAccount?: string;
        bankName?: string;
        bankChangeOtp?: string;
      };

      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name.trim();
      if (ownerName !== undefined) updates.ownerName = ownerName.trim();
      if (address !== undefined) updates.address = address.trim();
      if (phone !== undefined) updates.phone = phone.trim();

      // Lấy restaurant hiện tại (dùng chung cho cả email và bank account)
      let currentRestaurant = await Restaurant.findById(restaurantId);
      if (!currentRestaurant) {
        return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
      }

      // Xử lý đổi email - yêu cầu OTP
      if (email !== undefined) {
        const normalizedEmail = email.trim().toLowerCase();
        if (!currentRestaurant) {
          return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
        }

        // Nếu email mới khác email cũ, yêu cầu OTP
        if (currentRestaurant.email.toLowerCase() !== normalizedEmail) {
          if (!emailChangeOtp) {
            return res.status(400).json({ 
              message: "Cần mã OTP để đổi email. Vui lòng yêu cầu gửi OTP trước." 
            });
          }

          // Kiểm tra email có trùng với nhà hàng khác không
          const existingRestaurant = await Restaurant.findOne({
            email: normalizedEmail,
            _id: { $ne: restaurantId }
          });
          if (existingRestaurant) {
            return res.status(400).json({ message: "Email đã được sử dụng bởi nhà hàng khác" });
          }

          // Xác thực OTP
          const tokenDoc = await EmailChangeToken.findOne({
            restaurantId: new mongoose.Types.ObjectId(restaurantId),
            newEmail: normalizedEmail,
            otp: emailChangeOtp,
            used: false,
            expiresAt: { $gt: new Date() }
          });

          if (!tokenDoc) {
            return res.status(400).json({
              message: "Mã OTP không hợp lệ hoặc đã hết hạn"
            });
          }

          // Đánh dấu OTP đã dùng
          tokenDoc.used = true;
          await tokenDoc.save();
        }

        updates.email = normalizedEmail;
      }

      // Xử lý đổi tài khoản ngân hàng - yêu cầu OTP
      if (bankAccount !== undefined || bankName !== undefined) {
        const normalizedBankAccount = bankAccount?.trim() || "";
        const normalizedBankName = bankName?.trim() || "";
        
        const currentBankAccount = currentRestaurant.bankAccount?.trim() || "";
        const currentBankName = currentRestaurant.bankName?.trim() || "";

        // Kiểm tra xem có thay đổi tài khoản ngân hàng không
        const bankAccountChanged = 
          normalizedBankAccount !== currentBankAccount ||
          normalizedBankName !== currentBankName;

        if (bankAccountChanged) {
          if (!bankChangeOtp || bankChangeOtp.trim().length !== 6) {
            return res.status(400).json({ 
              message: "Cần mã OTP để đổi tài khoản ngân hàng. Vui lòng yêu cầu gửi OTP trước." 
            });
          }

          // Xác thực OTP
          const tokenDoc = await BankAccountChangeToken.findOne({
            restaurantId: new mongoose.Types.ObjectId(restaurantId),
            newBankAccount: normalizedBankAccount,
            newBankName: normalizedBankName,
            otp: bankChangeOtp.trim(),
            used: false,
            expiresAt: { $gt: new Date() }
          });

          if (!tokenDoc) {
            return res.status(400).json({
              message: "Mã OTP không hợp lệ hoặc đã hết hạn"
            });
          }

          // Đánh dấu OTP đã dùng
          tokenDoc.used = true;
          await tokenDoc.save();
        }

        if (normalizedBankAccount) updates.bankAccount = normalizedBankAccount;
        if (normalizedBankName) updates.bankName = normalizedBankName;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "Không có thông tin nào để cập nhật" });
      }

      const restaurant = await Restaurant.findByIdAndUpdate(restaurantId, updates, {
        new: true
      });

      if (!restaurant) {
        return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
      }

      res.json(restaurant);
    } catch (error) {
      res.status(400).json({ message: "Không thể cập nhật thông tin nhà hàng", error });
    }
  }
);

// Super Admin yêu cầu gửi OTP để đổi email nhà hàng
router.post(
  "/:id/request-email-change",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { newEmail } = req.body as { newEmail?: string };
      if (!newEmail) {
        return res.status(400).json({ message: "Thiếu email mới" });
      }

      const normalizedNewEmail = newEmail.trim().toLowerCase();

      // Kiểm tra email mới có trùng với nhà hàng khác không
      const existingRestaurant = await Restaurant.findOne({
        email: normalizedNewEmail,
        _id: { $ne: id }
      });
      if (existingRestaurant) {
        return res.status(400).json({ message: "Email đã được sử dụng bởi nhà hàng khác" });
      }

      // Lấy thông tin restaurant hiện tại
      const restaurant = await Restaurant.findById(id);
      if (!restaurant) {
        return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
      }

      // Kiểm tra email mới có khác email cũ không
      if (restaurant.email.toLowerCase() === normalizedNewEmail) {
        return res.status(400).json({ message: "Email mới phải khác email hiện tại" });
      }

      // Tạo OTP 6 chữ số
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Lưu OTP vào database (hết hạn sau 15 phút)
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);

      // Xóa các OTP cũ chưa dùng của restaurant này
      await EmailChangeToken.deleteMany({
        restaurantId: new mongoose.Types.ObjectId(id),
        used: false
      });

      await EmailChangeToken.create({
        restaurantId: new mongoose.Types.ObjectId(id),
        newEmail: normalizedNewEmail,
        otp,
        expiresAt,
        used: false
      });

      // Gửi email chứa OTP đến email hiện tại
      try {
        await sendEmailChangeOTP({
          to: restaurant.email,
          restaurantName: restaurant.name,
          ownerName: restaurant.ownerName,
          otp,
          newEmail: normalizedNewEmail
        });
      } catch (mailError) {
        console.error("Không thể gửi email OTP đổi email", mailError);
        return res.status(500).json({
          message: "Không thể gửi email OTP. Vui lòng thử lại sau."
        });
      }

      return res.json({
        message: "Đã gửi mã OTP đến email hiện tại của nhà hàng"
      });
    } catch (error) {
      console.error("Lỗi khi xử lý yêu cầu đổi email", error);
      return res.status(500).json({
        message: "Không thể xử lý yêu cầu đổi email"
      });
    }
  }
);

// Cập nhật nhà hàng - cho Super Admin (có thể cập nhật tất cả thông tin)
router.patch("/:id", requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      ownerName,
      email,
      address,
      phone,
      status,
      active
    } = req.body;

    const updates: Record<string, unknown> = {};

    // Cập nhật thông tin cơ bản
    if (name !== undefined) updates.name = name.trim();
    if (ownerName !== undefined) updates.ownerName = ownerName.trim();
    if (address !== undefined) updates.address = address.trim();
    if (phone !== undefined) updates.phone = phone.trim();

    // Cập nhật email (Super Admin không cần OTP, đổi trực tiếp)
    if (email !== undefined) {
      const normalizedEmail = email.trim().toLowerCase();
      
      // Kiểm tra email có trùng với nhà hàng khác không
      const existingRestaurant = await Restaurant.findOne({
        email: normalizedEmail,
        _id: { $ne: id }
      });
      if (existingRestaurant) {
        return res.status(400).json({ message: "Email đã được sử dụng bởi nhà hàng khác" });
      }

      updates.email = normalizedEmail;
    }

    // Cập nhật status và active
    if (typeof status === "string") {
      if (!Object.values(RestaurantStatus).includes(status as RestaurantStatus)) {
        return res.status(400).json({ message: "Trạng thái nhà hàng không hợp lệ" });
      }
      updates.status = status;
      updates.active = status === RestaurantStatus.ACTIVE;
    } else if (typeof active === "boolean" && status === undefined) {
      updates.active = active;
      updates.status = active ? RestaurantStatus.ACTIVE : RestaurantStatus.INACTIVE;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Không có thông tin nào để cập nhật" });
    }

    const restaurant = await Restaurant.findByIdAndUpdate(id, updates, {
      new: true
    });
    if (!restaurant) {
      return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
    }
    res.json(restaurant);
  } catch (error) {
    res.status(400).json({ message: "Không thể cập nhật nhà hàng", error });
  }
});

router.delete("/:id", requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res) => {
  try {
    const restaurant = await Restaurant.findByIdAndDelete(req.params.id);
    if (!restaurant) {
      return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
    }
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ message: "Không thể xóa nhà hàng", error });
  }
});

// Super Admin đặt lại mật khẩu admin nhà hàng
router.post(
  "/:id/reset-password",
  requireAuth,
  requireRole(UserRole.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { newPassword } = req.body as { newPassword?: string };
      if (!newPassword) {
        return res.status(400).json({ message: "Thiếu mật khẩu mới" });
      }

      const restaurant = await Restaurant.findById(req.params.id);
      if (!restaurant) {
        return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
      }

      const user = await User.findOne({
        restaurantId: restaurant._id,
        role: UserRole.RESTAURANT_ADMIN
      });

      if (!user) {
        return res
          .status(404)
          .json({ message: "Không tìm thấy tài khoản admin nhà hàng" });
      }

      user.passwordHash = await bcrypt.hash(newPassword, 10);
      await user.save();

      return res.json({
        message: "Đã đặt lại mật khẩu cho nhà hàng",
        restaurantId: restaurant._id,
        username: user.username
      });
    } catch (error) {
      return res
        .status(400)
        .json({ message: "Không thể đặt lại mật khẩu", error });
    }
  }
);

// Endpoint để tạo QR code từ API vietqr.co
router.post("/generate-qr", async (req, res) => {
  try {
    const { bankCode, accountNumber, accountName, amount } = req.body;

    if (!bankCode || !accountNumber || !accountName) {
      return res.status(400).json({ 
        message: "Thiếu thông tin: bankCode, accountNumber, accountName" 
      });
    }

    // Gọi API của vietqr.co với payload đúng format
    const response = await fetch("https://vietqr.co/livewire/message/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Livewire": "true",
      },
      body: JSON.stringify({
        fingerprint: {
          id: `qr-${Date.now()}`,
          name: "generate",
          locale: "vi",
          path: "generate",
          method: "GET",
          v: "acj"
        },
        serverMemo: {
          children: [],
          errors: []
        },
        updates: [{
          type: "callMethod",
          payload: {
            id: `method-${Date.now()}`,
            method: "generate",
            params: [bankCode, accountNumber, accountName, amount || null]
          }
        }]
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Lỗi khi gọi API vietqr.co:", error);
    res.status(500).json({ 
      message: "Không thể tạo QR code", 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
});

// Helper functions for date calculations
const calculateDateRange = (period: string, startDate?: string, endDate?: string): { start: Date; end: Date } => {
  const now = new Date();
  let start: Date;
  let end: Date = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (period === 'custom' && startDate && endDate) {
    start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
  } else if (period === 'today') {
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
    // Default to today
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
  }

  return { start, end };
};

const calculatePreviousPeriod = (start: Date, end: Date): { start: Date; end: Date } => {
  const diffTime = end.getTime() - start.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  prevEnd.setHours(23, 59, 59, 999);
  
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - diffDays + 1);
  prevStart.setHours(0, 0, 0, 0);
  
  return { start: prevStart, end: prevEnd };
};

const calculateAverageProcessingTime = (orders: any[]): number => {
  const completedOrders = orders.filter(o => 
    o.status === OrderStatus.COMPLETED && 
    o.createdAt && 
    o.updatedAt
  );
  
  if (completedOrders.length === 0) return 0;
  
  const totalMinutes = completedOrders.reduce((sum, order) => {
    const created = new Date(order.createdAt).getTime();
    const updated = new Date(order.updatedAt).getTime();
    const diffMinutes = (updated - created) / (1000 * 60);
    return sum + diffMinutes;
  }, 0);
  
  return Math.round(totalMinutes / completedOrders.length);
};

// Restaurant Admin: Lấy thống kê chi tiết
router.get(
  "/me/stats",
  requireAuth,
  requireRole([UserRole.RESTAURANT_ADMIN] as string[]),
  async (req: AuthRequest, res) => {
    try {
      const restaurantId = req.auth?.restaurantId;
      if (!restaurantId) {
        return res.status(403).json({ message: "Không xác định được nhà hàng" });
      }

      const { period = 'today', startDate, endDate } = req.query as {
        period?: string;
        startDate?: string;
        endDate?: string;
      };

      // Calculate date ranges
      const { start, end } = calculateDateRange(period, startDate, endDate);
      const { start: prevStart, end: prevEnd } = calculatePreviousPeriod(start, end);

      const restaurantObjectId = new mongoose.Types.ObjectId(restaurantId);

      // Get orders for current period
      const currentOrders = await Order.find({
        restaurantId: restaurantObjectId,
        createdAt: { $gte: start, $lte: end }
      });

      // Get orders for previous period
      const previousOrders = await Order.find({
        restaurantId: restaurantObjectId,
        createdAt: { $gte: prevStart, $lte: prevEnd }
      });

      // Overview calculations
      const currentCompletedOrders = currentOrders.filter(
        o => o.status === OrderStatus.COMPLETED || o.status === OrderStatus.SERVED
      );
      const previousCompletedOrders = previousOrders.filter(
        o => o.status === OrderStatus.COMPLETED || o.status === OrderStatus.SERVED
      );

      const totalRevenue = currentCompletedOrders.reduce((sum, o) => sum + o.totalAmount, 0);
      const previousRevenue = previousCompletedOrders.reduce((sum, o) => sum + o.totalAmount, 0);
      
      // Calculate revenue change: null if no previous data, otherwise percentage
      let revenueChange: number | null = null;
      if (previousRevenue > 0) {
        revenueChange = ((totalRevenue - previousRevenue) / previousRevenue) * 100;
      } else if (previousRevenue === 0 && totalRevenue > 0) {
        // New data, no comparison possible - return null to indicate "new"
        revenueChange = null;
      } else {
        revenueChange = 0; // Both are 0
      }

      const totalOrders = currentCompletedOrders.length;
      const previousOrdersCount = previousCompletedOrders.length;
      
      // Calculate orders change: null if no previous data, otherwise percentage
      let ordersChange: number | null = null;
      if (previousOrdersCount > 0) {
        ordersChange = ((totalOrders - previousOrdersCount) / previousOrdersCount) * 100;
      } else if (previousOrdersCount === 0 && totalOrders > 0) {
        // New data, no comparison possible
        ordersChange = null;
      } else {
        ordersChange = 0; // Both are 0
      }

      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
      const previousAverageOrderValue = previousOrdersCount > 0 ? previousRevenue / previousOrdersCount : 0;

      // Unique customers
      const uniqueCustomers = new Set(
        currentOrders
          .filter(o => o.customerName)
          .map(o => o.customerName?.toLowerCase().trim())
      ).size;

      // Cancellation rate
      const cancelledCount = currentOrders.filter(o => o.status === OrderStatus.CANCELLED).length;
      const cancellationRate = currentOrders.length > 0 
        ? (cancelledCount / currentOrders.length) * 100 
        : 0;

      // Average processing time
      const avgProcessingTime = calculateAverageProcessingTime(currentOrders);

      // Revenue by date
      const revenueByDateMap = new Map<string, { revenue: number; orders: number }>();
      currentCompletedOrders.forEach(order => {
        const dateKey = new Date(order.createdAt || new Date()).toISOString().split('T')[0];
        const current = revenueByDateMap.get(dateKey) || { revenue: 0, orders: 0 };
        revenueByDateMap.set(dateKey, {
          revenue: current.revenue + order.totalAmount,
          orders: current.orders + 1
        });
      });
      const revenueByDate = Array.from(revenueByDateMap.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Revenue by hour
      const revenueByHourMap = new Map<number, { revenue: number; orders: number }>();
      currentCompletedOrders.forEach(order => {
        const hour = new Date(order.createdAt || new Date()).getHours();
        const current = revenueByHourMap.get(hour) || { revenue: 0, orders: 0 };
        revenueByHourMap.set(hour, {
          revenue: current.revenue + order.totalAmount,
          orders: current.orders + 1
        });
      });
      const revenueByHour = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        revenue: revenueByHourMap.get(i)?.revenue || 0,
        orders: revenueByHourMap.get(i)?.orders || 0
      }));

      // Top menu items
      const menuItemMap = new Map<string, { menuItemId: string; name: string; quantity: number; revenue: number }>();
      currentCompletedOrders.forEach(order => {
        order.items.forEach(item => {
          const current = menuItemMap.get(item.menuItemId) || { menuItemId: item.menuItemId, name: item.name, quantity: 0, revenue: 0 };
          menuItemMap.set(item.menuItemId, {
            menuItemId: item.menuItemId,
            name: item.name,
            quantity: current.quantity + item.quantity,
            revenue: current.revenue + (item.price * item.quantity)
          });
        });
      });
      const topMenuItems = Array.from(menuItemMap.values())
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10);

      // Revenue by category - Get menu items to map categories
      const menuItems = await MenuItem.find({ restaurantId: restaurantObjectId });
      const menuItemCategoryMap = new Map<string, string>();
      menuItems.forEach(item => {
        menuItemCategoryMap.set(item._id.toString(), item.category);
      });

      const categoryRevenueMap = new Map<string, { revenue: number; quantity: number }>();
      currentCompletedOrders.forEach(order => {
        order.items.forEach(item => {
          const category = menuItemCategoryMap.get(item.menuItemId) || 'Khác';
          const current = categoryRevenueMap.get(category) || { revenue: 0, quantity: 0 };
          categoryRevenueMap.set(category, {
            revenue: current.revenue + (item.price * item.quantity),
            quantity: current.quantity + item.quantity
          });
        });
      });
      const revenueByCategory = Array.from(categoryRevenueMap.entries())
        .map(([category, data]) => ({ category, ...data }))
        .sort((a, b) => b.revenue - a.revenue);

      // Revenue by table
      const tableMap = new Map<string, { revenue: number; orders: number }>();
      currentCompletedOrders.forEach(order => {
        const current = tableMap.get(order.tableNumber) || { revenue: 0, orders: 0 };
        tableMap.set(order.tableNumber, {
          revenue: current.revenue + order.totalAmount,
          orders: current.orders + 1
        });
      });
      const revenueByTable = Array.from(tableMap.entries())
        .map(([tableNumber, data]) => ({ tableNumber, ...data }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 20);

      // Orders by status
      const ordersByStatus = {
        pending: currentOrders.filter(o => o.status === OrderStatus.PENDING).length,
        confirmed: currentOrders.filter(o => o.status === OrderStatus.CONFIRMED).length,
        served: currentOrders.filter(o => o.status === OrderStatus.SERVED).length,
        completed: currentOrders.filter(o => o.status === OrderStatus.COMPLETED).length,
        cancelled: currentOrders.filter(o => o.status === OrderStatus.CANCELLED).length
      };

      // Largest orders
      const largestOrders = currentCompletedOrders
        .map(order => ({
          orderId: order._id.toString(),
          tableNumber: order.tableNumber,
          totalAmount: order.totalAmount,
          customerName: order.customerName,
          createdAt: order.createdAt || new Date()
        }))
        .sort((a, b) => b.totalAmount - a.totalAmount)
        .slice(0, 20);

      // Top selling menu item (for KPI)
      const topSellingItem = topMenuItems.length > 0 ? topMenuItems[0] : null;
      const peakHour = revenueByHour.reduce((max, item) => 
        item.revenue > max.revenue ? item : max, 
        revenueByHour[0] || { hour: 0, revenue: 0, orders: 0 }
      );

      res.json({
        period: {
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0]
        },
        previousPeriod: {
          startDate: prevStart.toISOString().split('T')[0],
          endDate: prevEnd.toISOString().split('T')[0]
        },
        overview: {
          totalRevenue,
          previousRevenue,
          revenueChange: revenueChange !== null ? Math.round(revenueChange * 100) / 100 : null,
          totalOrders,
          previousOrders: previousOrdersCount,
          ordersChange: ordersChange !== null ? Math.round(ordersChange * 100) / 100 : null,
          averageOrderValue: Math.round(averageOrderValue),
          previousAverageOrderValue: Math.round(previousAverageOrderValue),
          totalCustomers: uniqueCustomers,
          cancellationRate: Math.round(cancellationRate * 100) / 100,
          averageProcessingTime: avgProcessingTime,
          topSellingItem: topSellingItem ? {
            name: topSellingItem.name,
            quantity: topSellingItem.quantity
          } : null,
          peakHour: peakHour.hour
        },
        revenueByDate,
        revenueByHour,
        topMenuItems,
        revenueByCategory,
        revenueByTable,
        ordersByStatus,
        largestOrders
      });
    } catch (error) {
      console.error("Error fetching restaurant stats:", error);
      res.status(500).json({ message: "Không thể lấy thống kê", error });
    }
  }
);

export default router;

