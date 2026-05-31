import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";

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
import { initRealtime } from "./realtime/socket.js";

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.use("/api/auth", authRoutes);
app.use("/api/owners", ownerRoutes);
app.use("/api/owner/restaurants", ownerRestaurantRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api", subscriptionRoutes);
app.use("/api/admin", adminSubscriptionRoutes);
app.use("/api", notificationRoutes);
app.use("/api/ingredients", ingredientRoutes);
app.use("/api/nutrition", nutritionRoutes);

connectDB().then(() => {
  initRealtime(httpServer);

  httpServer.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
  });
});
