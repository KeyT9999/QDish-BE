import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";

import { createCorsOptions } from "./config/cors.js";
import { connectDB } from "./config/db.js";
import restaurantRoutes from "./routes/restaurantRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import ownerRoutes from "./routes/ownerRoutes.js";
import ownerRestaurantRoutes from "./routes/ownerRestaurantRoutes.js";
import tableRoutes from "./routes/tableRoutes.js";
import menuRoutes from "./routes/menuRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import staffRoutes from "./routes/staffRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import adminSubscriptionRoutes from "./routes/adminSubscriptionRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import ingredientRoutes from "./routes/ingredientRoutes.js";
import nutritionRoutes from "./routes/nutritionRoutes.js";
import fitScoreRoutes from "./routes/fitScoreRoutes.js";
import userProfileRoutes from "./routes/userProfileRoutes.js";
import recommendationRoutes from "./routes/recommendationRoutes.js";
import insightRoutes from "./routes/insightRoutes.js";
import tableSessionRoutes from "./routes/tableSessionRoutes.js";
import billRoutes from "./routes/billRoutes.js";
import { initRealtime } from "./realtime/socket.js";
import { initSubscriptionCronJob } from "./services/subscriptionCronJob.js";

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;
const corsOptions = createCorsOptions();

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    environment: process.env.NODE_ENV || "production",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.use("/api/auth", authRoutes);
app.use("/api/owners", ownerRoutes);
app.use("/api/owner/restaurants", ownerRestaurantRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/restaurants", insightRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api", subscriptionRoutes);
app.use("/api/admin", adminSubscriptionRoutes);
app.use("/api/table-sessions", tableSessionRoutes);
app.use("/api/bills", billRoutes);
app.use("/api", notificationRoutes);
app.use("/api/ingredients", ingredientRoutes);
app.use("/api/nutrition", nutritionRoutes);
app.use("/api/dishes", fitScoreRoutes);
app.use("/api/users", userProfileRoutes);
app.use("/api/recommendations", recommendationRoutes);

connectDB().then(() => {
  initRealtime(httpServer);
  initSubscriptionCronJob();

  httpServer.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
  });
});
