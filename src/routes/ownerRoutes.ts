import { Router } from "express";
import bcrypt from "bcryptjs";
import { User, UserRole } from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// Áp dụng bảo vệ cho tất cả các route bên dưới: Chỉ SUPER_ADMIN mới được thao tác
router.use(requireAuth);
router.use(requireRole(UserRole.SUPER_ADMIN));

// 1. POST /api/owners - Super Admin tạo Chủ nhà hàng mới
router.post("/", async (req, res) => {
  try {
    const { fullName, email, phone, username, password, isActive } = req.body;

    // Validation
    if (!fullName || !email || !phone || !username || !password) {
      return res.status(400).json({ message: "Vui lòng nhập đầy đủ các thông tin bắt buộc" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ message: "Định dạng email không hợp lệ" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Mật khẩu phải tối thiểu 6 ký tự" });
    }

    // Check unique username
    const existingUsername = await User.findOne({ username: username.trim() });
    if (existingUsername) {
      return res.status(409).json({ message: "Tên đăng nhập đã tồn tại" });
    }

    // Check unique email
    const existingEmail = await User.findOne({ email: email.trim().toLowerCase() });
    if (existingEmail) {
      return res.status(409).json({ message: "Email đã được đăng ký bởi tài khoản khác" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user RESTAURANT_OWNER
    const newOwner = await User.create({
      username: username.trim(),
      passwordHash,
      role: UserRole.RESTAURANT_OWNER,
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      isActive: isActive !== undefined ? isActive : true,
      updatedBy: (req as any).auth?.sub
    });

    return res.status(201).json({
      message: "Tạo tài khoản chủ nhà hàng thành công",
      user: {
        id: newOwner._id,
        fullName: newOwner.fullName,
        email: newOwner.email,
        phone: newOwner.phone,
        username: newOwner.username,
        role: newOwner.role,
        isActive: newOwner.isActive,
        createdAt: (newOwner as any).createdAt
      }
    });
  } catch (error: any) {
    console.error("Lỗi khi Super Admin tạo chủ nhà hàng:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tạo tài khoản chủ nhà hàng" });
  }
});

// 2. GET /api/owners - Super Admin lấy danh sách chủ nhà hàng
router.post("/list", async (req, res) => {
  // We can support POST `/list` or GET `/` for flexible searching.
  // The task asks for `GET /api/owners`. Let's implement both or GET `/` with query params.
});

router.get("/", async (req, res) => {
  try {
    const { search, status } = req.query;

    const query: any = { role: UserRole.RESTAURANT_OWNER };

    if (status === "ACTIVE") {
      query.isActive = true;
    } else if (status === "INACTIVE") {
      query.isActive = false;
    }

    if (search) {
      const searchRegex = new RegExp(String(search).trim(), "i");
      query.$or = [
        { fullName: searchRegex },
        { username: searchRegex },
        { email: searchRegex },
        { phone: searchRegex }
      ];
    }

    const owners = await User.find(query)
      .select("-passwordHash")
      .sort({ createdAt: -1 })
      .lean();

    // Query owned restaurants count and names for each owner
    const { Restaurant } = await import("../models/Restaurant.js");
    const { getOwnerSubscription } = await import("../services/subscriptionService.js");
    const { Plan } = await import("../models/Plan.js");

    const ownersWithRestaurants = await Promise.all(
      owners.map(async (owner) => {
        const ownedBranches = await Restaurant.find({ ownerId: owner._id }).select("name");
        
        let planName = "N/A";
        let planCode = "N/A";
        let subscriptionStatus = "N/A";
        let subscriptionExpiresAt = null;

        try {
          const sub = await getOwnerSubscription(owner._id);
          const plan = await Plan.findById(sub.planId);
          planName = plan ? plan.name : "FREE";
          planCode = sub.planCode;
          subscriptionStatus = sub.status;
          subscriptionExpiresAt = sub.expiresAt || null;
        } catch (subErr) {
          console.error(`Lỗi khi lấy subscription cho owner ${owner._id}:`, subErr);
        }

        return {
          ...owner,
          id: owner._id.toString(),
          restaurantsCount: ownedBranches.length,
          restaurants: ownedBranches.map(r => r.name),
          planName,
          planCode,
          subscriptionStatus,
          subscriptionExpiresAt
        };
      })
    );

    return res.json(ownersWithRestaurants);
  } catch (error: any) {
    console.error("Lỗi khi tải danh sách chủ nhà hàng:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tải danh sách" });
  }
});

// 3. GET /api/owners/:id - Lấy chi tiết chủ nhà hàng
router.get("/:id", async (req, res) => {
  try {
    const owner = await User.findOne({
      _id: req.params.id,
      role: UserRole.RESTAURANT_OWNER
    }).select("-passwordHash");

    if (!owner) {
      return res.status(404).json({ message: "Không tìm thấy chủ nhà hàng" });
    }

    return res.json(owner);
  } catch (error) {
    console.error("Lỗi khi lấy thông tin chủ nhà hàng:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi tải thông tin" });
  }
});

// 4. PATCH /api/owners/:id - Super Admin cập nhật thông tin chủ nhà hàng
router.patch("/:id", async (req, res) => {
  try {
    const { fullName, email, phone, isActive } = req.body;

    const owner = await User.findOne({
      _id: req.params.id,
      role: UserRole.RESTAURANT_OWNER
    });

    if (!owner) {
      return res.status(404).json({ message: "Không tìm thấy chủ nhà hàng" });
    }

    // Check unique email if modified
    if (email && email.trim().toLowerCase() !== owner.email?.toLowerCase()) {
      const existingEmail = await User.findOne({ email: email.trim().toLowerCase() });
      if (existingEmail) {
        return res.status(409).json({ message: "Email đã được đăng ký bởi tài khoản khác" });
      }
      owner.email = email.trim().toLowerCase();
    }

    if (fullName !== undefined) owner.fullName = fullName.trim();
    if (phone !== undefined) owner.phone = phone.trim();
    if (isActive !== undefined) owner.isActive = isActive;

    owner.updatedBy = (req as any).auth?.sub;
    await owner.save();

    return res.json({
      message: "Cập nhật thông tin thành công",
      user: {
        id: owner._id,
        fullName: owner.fullName,
        email: owner.email,
        phone: owner.phone,
        username: owner.username,
        role: owner.role,
        isActive: owner.isActive
      }
    });
  } catch (error: any) {
    console.error("Lỗi khi cập nhật thông tin chủ nhà hàng:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi cập nhật thông tin" });
  }
});

// 5. PATCH /api/owners/:id/toggle-active - Khóa hoặc mở khóa tài khoản
router.patch("/:id/toggle-active", async (req, res) => {
  try {
    const owner = await User.findOne({
      _id: req.params.id,
      role: UserRole.RESTAURANT_OWNER
    });

    if (!owner) {
      return res.status(404).json({ message: "Không tìm thấy chủ nhà hàng" });
    }

    owner.isActive = !owner.isActive;
    owner.updatedBy = (req as any).auth?.sub;
    await owner.save();

    return res.json({
      isActive: owner.isActive,
      message: owner.isActive ? "Đã mở khóa tài khoản thành công" : "Đã khóa tài khoản thành công"
    });
  } catch (error) {
    console.error("Lỗi khi bật/tắt trạng thái hoạt động chủ nhà hàng:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi thay đổi trạng thái" });
  }
});

// 6. POST /api/owners/:id/reset-password - Đặt lại mật khẩu
router.post("/:id/reset-password", async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.trim().length < 6) {
      return res.status(400).json({ message: "Mật khẩu mới phải có tối thiểu 6 ký tự" });
    }

    const owner = await User.findOne({
      _id: req.params.id,
      role: UserRole.RESTAURANT_OWNER
    });

    if (!owner) {
      return res.status(404).json({ message: "Không tìm thấy chủ nhà hàng" });
    }

    const passwordHash = await bcrypt.hash(newPassword.trim(), 10);
    owner.passwordHash = passwordHash;
    owner.updatedBy = (req as any).auth?.sub;
    await owner.save();

    return res.json({
      message: `Đặt lại mật khẩu thành công cho chủ nhà hàng ${owner.fullName || owner.username}`
    });
  } catch (error) {
    console.error("Lỗi khi reset mật khẩu chủ nhà hàng:", error);
    return res.status(500).json({ message: "Lỗi hệ thống khi reset mật khẩu" });
  }
});

export default router;
