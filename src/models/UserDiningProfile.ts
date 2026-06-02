import mongoose, { Schema, Document } from "mongoose";

export interface IUserDiningProfile extends Document {
  userId: string; // Guest session ID or registered User ID
  isGuest: boolean;

  // Explicit preferences (set by the user)
  goals: string[]; // e.g., ["MUSCLE_GAIN", "BALANCED"]
  allergies: string[]; // e.g., ["gluten", "dairy"]
  dietaryPreferences: string[]; // e.g., ["vegetarian", "keto"]
  dailyCalorieTarget?: number;

  // Learned preferences (auto-computed from dining behavior)
  favoriteAttributes: Map<string, number>; // e.g., { HIGH_PROTEIN: 1.5, COMFORT_FOOD: -0.5 }

  // Gamification & engagement
  diningPersonality?: string; // e.g., "Protein Hunter"
  badges: string[];
  interactionCount: number;
  profileCompleteness: number; // 0.0 - 1.0

  createdAt: Date;
  updatedAt: Date;
}

const UserDiningProfileSchema = new Schema<IUserDiningProfile>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    isGuest: { type: Boolean, default: true },

    goals: { type: [String], default: [] },
    allergies: { type: [String], default: [] },
    dietaryPreferences: { type: [String], default: [] },
    dailyCalorieTarget: { type: Number, required: false },

    favoriteAttributes: { type: Map, of: Number, default: {} },

    diningPersonality: { type: String, default: "Exploring Foodie" },
    badges: { type: [String], default: [] },
    interactionCount: { type: Number, default: 0 },
    profileCompleteness: { type: Number, default: 0.0 }
  },
  { timestamps: true }
);

export const UserDiningProfile = mongoose.model<IUserDiningProfile>("UserDiningProfile", UserDiningProfileSchema);
