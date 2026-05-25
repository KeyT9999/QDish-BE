import "dotenv/config";
import { connectDB } from "../config/db.js";
import { Plan } from "../models/Plan.js";

const plansData = [
  {
    name: "Starter / FREE",
    code: "FREE",
    description: "Phù hợp cho quán ăn nhỏ, cafe hoặc dùng thử dịch vụ",
    priceMonthly: 0,
    priceYearly: 0,
    restaurantLimit: 1,
    tableLimit: 5,
    menuItemLimit: 10,
    staffLimit: 3,
    features: [
      "1 chi nhánh/nhà hàng",
      "Tối đa 5 bàn",
      "Tối đa 10 món",
      "Tối đa 3 nhân viên (staff)",
      "QR menu cơ bản",
      "Order realtime cơ bản",
      "Dashboard thống kê cơ bản",
      "Thông tin dinh dưỡng cơ bản"
    ],
    isPopular: false,
    isActive: true,
    sortOrder: 1
  },
  {
    name: "Growth / PLUS",
    code: "PLUS",
    description: "Tối ưu cho quán vừa, đông khách hoặc chuỗi local nhỏ",
    priceMonthly: 299000,
    priceYearly: 2990000,
    restaurantLimit: 3,
    tableLimit: 30,
    menuItemLimit: 150,
    staffLimit: 15,
    features: [
      "Tất cả tính năng của gói FREE",
      "Tối đa 3 chi nhánh/nhà hàng",
      "Tối đa 30 bàn",
      "Tối đa 150 món",
      "Tối đa 15 nhân viên (staff)",
      "Analytics doanh thu nâng cao & món bán chạy",
      "Peak hour analytics (phân tích giờ cao điểm)",
      "Bộ lọc dinh dưỡng & Health recommendation nâng cao",
      "Advanced realtime alert & Popup chuông báo bếp",
      "Xuất báo cáo Excel / PDF",
      "Custom logo nhà hàng & branding nhẹ",
      "Hỗ trợ ưu tiên cơ bản"
    ],
    isPopular: true,
    isActive: true,
    sortOrder: 2
  },
  {
    name: "Restaurant / PRO",
    code: "PRO",
    description: "Thích hợp cho nhà hàng lớn, chuỗi chi nhánh, cloud kitchen chuyên nghiệp",
    priceMonthly: 999000,
    priceYearly: 9990000,
    restaurantLimit: -1, // Unlimited
    tableLimit: -1,      // Unlimited
    menuItemLimit: -1,   // Unlimited
    staffLimit: -1,      // Unlimited
    features: [
      "Tất cả tính năng của gói PLUS",
      "Không giới hạn số lượng chi nhánh",
      "Không giới hạn số lượng bàn",
      "Không giới hạn số lượng món ăn",
      "Không giới hạn số lượng nhân viên",
      "Quản lý chuỗi đa chi nhánh (Centralized dashboard)",
      "Phân tích so sánh hiệu suất giữa các chi nhánh",
      "Quản lý bếp trung tâm (Multi-kitchen workflow)",
      "Hệ thống phân quyền nâng cao (Full permission system)",
      "Màn hình KDS nâng cao cho bếp",
      "Đồng bộ thời gian thực đa thiết bị chuyên nghiệp",
      "Sẵn sàng API Integration & Custom Domain"
    ],
    isPopular: false,
    isActive: true,
    sortOrder: 3
  }
];

const run = async () => {
  await connectDB();

  console.log("🌱 Seeding subscription plans...");

  for (const planData of plansData) {
    const existing = await Plan.findOne({ code: planData.code });
    if (existing) {
      console.log(`Plan ${planData.code} already exists. Updating limits & pricing...`);
      await Plan.updateOne({ code: planData.code }, planData);
    } else {
      console.log(`Creating Plan ${planData.code}...`);
      await Plan.create(planData);
    }
  }

  console.log("✅ Seeding subscription plans completed!");
  process.exit(0);
};

run().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
