import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { User, UserRole } from "../models/User.js";
import { Restaurant } from "../models/Restaurant.js";
import { PasswordResetToken } from "../models/PasswordResetToken.js";
import { sendPasswordResetEmail } from "../services/emailService.js";
import { AuthRequest, requireAuth } from "../middleware/auth.js";

const router = Router();

const JWT_SECRET: string = process.env.JWT_SECRET || "change-me";
const TOKEN_EXPIRY: string = process.env.JWT_EXPIRY || "12h";

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Thiếu tên đăng nhập/email hoặc mật khẩu" });
  }

  let user = await User.findOne({ username: username.trim() });

  // Nếu không tìm thấy user theo username, thử tìm theo email của restaurant
  if (!user) {
    const normalizedEmail = username.trim().toLowerCase();
    const restaurant = await Restaurant.findOne({ email: normalizedEmail });
    
    if (restaurant) {
      // Tìm user admin của restaurant này
      user = await User.findOne({
        restaurantId: restaurant._id,
        role: UserRole.RESTAURANT_ADMIN
      });
    }
  }

  if (!user) {
    return res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu" });
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu" });
  }

  // Kiểm tra nhân viên có bị khóa không (sau khi xác thực password)
  if (user.role === UserRole.STAFF && user.isActive === false) {
    return res.status(403).json({ message: "Tài khoản nhân viên đã bị khóa" });
  }

  const payload = {
    sub: user._id.toString(),
    username: user.username,
    role: user.role,
    restaurantId: user.restaurantId?.toString() || null
  };

  const token = jwt.sign(
    payload,
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY } as jwt.SignOptions
  );

  res.json({
    token,
    user: {
      id: user._id,
      username: user.username,
      role: user.role as UserRole,
      restaurantId: user.restaurantId || null
    }
  });
});

// Đổi mật khẩu cho user hiện tại (dựa trên JWT)
router.post("/change-password", requireAuth, async (req: AuthRequest, res) => {
  const { oldPassword, newPassword } = req.body as {
    oldPassword?: string;
    newPassword?: string;
  };

  if (!oldPassword || !newPassword) {
    return res
      .status(400)
      .json({ message: "Thiếu oldPassword hoặc newPassword" });
  }

  if (!req.auth?.sub) {
    return res.status(401).json({ message: "Không xác định được người dùng" });
  }

  const user = await User.findById(req.auth.sub);
  if (!user) {
    return res.status(404).json({ message: "User không tồn tại" });
  }

  const isValid = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!isValid) {
    return res.status(400).json({ message: "Mật khẩu cũ không đúng" });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  user.passwordHash = passwordHash;
  await user.save();

  return res.json({ message: "Đổi mật khẩu thành công" });
});

// Yêu cầu đặt lại mật khẩu (gửi OTP qua email)
router.post("/request-password-reset", async (req, res) => {
  try {
    const { email } = req.body as { email?: string };

    if (!email) {
      return res.status(400).json({ message: "Thiếu email" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Tìm restaurant theo email
    const restaurant = await Restaurant.findOne({ email: normalizedEmail });
    if (!restaurant) {
      // Không tiết lộ email có tồn tại hay không vì lý do bảo mật
      return res.json({ message: "Nếu email tồn tại, bạn sẽ nhận được mã OTP" });
    }

    // Tìm user admin của restaurant
    const user = await User.findOne({
      restaurantId: restaurant._id,
      role: UserRole.RESTAURANT_ADMIN
    });

    if (!user) {
      return res.json({ message: "Nếu email tồn tại, bạn sẽ nhận được mã OTP" });
    }

    // Tạo OTP 6 chữ số
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Lưu OTP vào database (hết hạn sau 15 phút)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    // Xóa các OTP cũ chưa dùng của email này
    await PasswordResetToken.deleteMany({
      email: normalizedEmail,
      used: false
    });

    await PasswordResetToken.create({
      email: normalizedEmail,
      otp,
      expiresAt,
      restaurantId: restaurant._id,
      used: false
    });

    // Gửi email chứa OTP
    try {
      await sendPasswordResetEmail({
        to: normalizedEmail,
        restaurantName: restaurant.name,
        ownerName: restaurant.ownerName,
        otp
      });
    } catch (mailError) {
      console.error("Không thể gửi email đặt lại mật khẩu", mailError);
      return res.status(500).json({
        message: "Không thể gửi email. Vui lòng thử lại sau."
      });
    }

    // Không tiết lộ email có tồn tại hay không
    return res.json({
      message: "Nếu email tồn tại, bạn sẽ nhận được mã OTP"
    });
  } catch (error) {
    console.error("Lỗi khi xử lý yêu cầu đặt lại mật khẩu", error);
    return res.status(500).json({
      message: "Không thể xử lý yêu cầu đặt lại mật khẩu"
    });
  }
});

// Đặt lại mật khẩu bằng OTP
router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body as {
      email?: string;
      otp?: string;
      newPassword?: string;
    };

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        message: "Thiếu email, OTP hoặc mật khẩu mới"
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: "Mật khẩu mới cần ít nhất 6 ký tự"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Tìm OTP token hợp lệ
    const tokenDoc = await PasswordResetToken.findOne({
      email: normalizedEmail,
      otp,
      used: false,
      expiresAt: { $gt: new Date() } // Chưa hết hạn
    });

    if (!tokenDoc) {
      return res.status(400).json({
        message: "Mã OTP không hợp lệ hoặc đã hết hạn"
      });
    }

    // Tìm restaurant
    const restaurant = await Restaurant.findById(tokenDoc.restaurantId);
    if (!restaurant) {
      return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
    }

    // Tìm user admin
    const user = await User.findOne({
      restaurantId: restaurant._id,
      role: UserRole.RESTAURANT_ADMIN
    });

    if (!user) {
      return res.status(404).json({
        message: "Không tìm thấy tài khoản admin nhà hàng"
      });
    }

    // Cập nhật mật khẩu
    const passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordHash = passwordHash;
    await user.save();

    // Đánh dấu OTP đã dùng
    tokenDoc.used = true;
    await tokenDoc.save();

    return res.json({ message: "Đặt lại mật khẩu thành công" });
  } catch (error) {
    console.error("Lỗi khi đặt lại mật khẩu", error);
    return res.status(500).json({
      message: "Không thể đặt lại mật khẩu"
    });
  }
});

export default router;

