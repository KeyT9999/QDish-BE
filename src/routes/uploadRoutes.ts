import { Router } from "express";
import multer from "multer";
import { v2 as cloudinary, UploadApiResponse } from "cloudinary";

import { AuthRequest, requireAuth } from "../middleware/auth.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Chỉ hỗ trợ upload file ảnh"));
      return;
    }
    cb(null, true);
  }
});

const uploadMenuImage = upload.single("file");

const isCloudinaryConfigured = () => {
  return Boolean(
    process.env.CLOUDINARY_URL ||
    (
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    )
  );
};

const configureCloudinary = () => {
  if (process.env.CLOUDINARY_URL) return;

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
};

const uploadToCloudinary = (file: Express.Multer.File, folder: string) => {
  return new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        transformation: [
          { width: 1200, height: 900, crop: "limit" },
          { quality: "auto", fetch_format: "auto" }
        ]
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error("Không nhận được kết quả upload từ Cloudinary"));
          return;
        }
        resolve(result);
      }
    );

    stream.end(file.buffer);
  });
};

router.post(
  "/menu-image",
  requireAuth,
  (req, res, next) => {
    uploadMenuImage(req, res, (error) => {
      if (error) {
        return res.status(400).json({ message: error.message || "Không thể đọc file ảnh" });
      }
      next();
    });
  },
  async (req: AuthRequest, res) => {
    if (!req.auth?.restaurantId) {
      return res.status(403).json({ message: "Chỉ admin nhà hàng mới được upload ảnh món ăn" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Thiếu file ảnh cần upload" });
    }

    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        message: "Backend chưa cấu hình Cloudinary. Vui lòng thêm CLOUDINARY_URL hoặc CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET."
      });
    }

    configureCloudinary();

    const folder = process.env.CLOUDINARY_FOLDER || "qdish/menu-items";
    const result = await uploadToCloudinary(req.file, folder);

    return res.status(201).json({
      url: result.secure_url,
      publicId: result.public_id
    });
  }
);

export default router;
