import mongoose from "mongoose";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/nhahang";

export const connectDB = async () => {
  const uri = process.env.MONGODB_URI || DEFAULT_URI;

  try {
    await mongoose.connect(uri);
    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
};

