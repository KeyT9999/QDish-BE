import "dotenv/config";
import { connectDB } from "../config/db.js";
import { Plan } from "../models/Plan.js";

const plansData = [
  {
    name: "FREE",
    code: "FREE",
    description: "Khởi động số hóa thực đơn & nâng cao tương tác ban đầu",
    priceMonthly: 0,
    priceYearly: 0,
    restaurantLimit: 1,
    tableLimit: 5,
    menuItemLimit: 10,
    staffLimit: 3,
    scanLimitMonthly: 500,
    fitScoreEnabled: false,
    foodAttributesEnabled: false,
    recommendationEnabled: false,
    personalizedMenuEnabled: false,
    advancedAnalyticsEnabled: false,
    customerInsightsEnabled: false,
    features: [
      "1 chi nhánh hoạt động",
      "QR Menu số hóa chuẩn hóa",
      "Hồ sơ dinh dưỡng thực đơn"
    ],
    unavailableFeatures: [
      "Fit Score & Cá nhân hóa menu",
      "Dashboard quản trị sâu"
    ],
    isPopular: false,
    isActive: true,
    sortOrder: 1
  },
  {
    name: "PLUS",
    code: "PLUS",
    description: "Cá nhân hóa tối đa trải nghiệm thực khách & tối ưu thực đơn",
    priceMonthly: 299000,
    priceYearly: 2990000,
    restaurantLimit: 3,
    tableLimit: 30,
    menuItemLimit: 150,
    staffLimit: 15,
    scanLimitMonthly: 5000,
    fitScoreEnabled: true,
    foodAttributesEnabled: true,
    recommendationEnabled: true,
    personalizedMenuEnabled: true,
    advancedAnalyticsEnabled: false,
    customerInsightsEnabled: false,
    features: [
      "Tối đa 3 chi nhánh",
      "QR Menu & Hồ sơ dinh dưỡng",
      "Fit Score / Điểm tương thích món",
      "Personalized Menu cá nhân",
      "Food Attributes chuyên sâu"
    ],
    unavailableFeatures: [
      "Dashboard quản trị sâu"
    ],
    isPopular: true,
    isActive: true,
    sortOrder: 2
  },
  {
    name: "PRO",
    code: "PRO",
    description: "Khai thác tối đa tài nguyên dữ liệu & thúc đẩy tăng trưởng doanh thu",
    priceMonthly: 999000,
    priceYearly: 9990000,
    restaurantLimit: -1, // Không giới hạn chi nhánh
    tableLimit: -1,      // Không giới hạn bàn (bỏ bàn)
    menuItemLimit: -1,
    staffLimit: -1,      // Không giới hạn nhân viên (bỏ nhân viên)
    scanLimitMonthly: -1, // Vô hạn scan
    fitScoreEnabled: true,
    foodAttributesEnabled: true,
    recommendationEnabled: true,
    personalizedMenuEnabled: true,
    advancedAnalyticsEnabled: true,
    customerInsightsEnabled: true,
    features: [
      "Không giới hạn chi nhánh",
      "Bao gồm mọi tính năng của PLUS",
      "AI Recommendation Engine",
      "Merchant Dashboard & Analytics",
      "Customer Insights & Phân tích sâu"
    ],
    unavailableFeatures: [],
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
