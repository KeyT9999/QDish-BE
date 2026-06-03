import mongoose, { Schema, Document } from "mongoose";

export interface IPlan extends Document {
  name: string;
  code: string; // e.g., "FREE", "PLUS", "PRO"
  description: string;
  priceMonthly: number;
  priceYearly: number;
  restaurantLimit: number; // -1 for unlimited
  tableLimit: number;      // -1 for unlimited
  menuItemLimit: number;   // -1 for unlimited
  staffLimit: number;      // -1 for unlimited
  scanLimitMonthly: number; // -1 for unlimited
  fitScoreEnabled: boolean;
  foodAttributesEnabled: boolean;
  recommendationEnabled: boolean;
  personalizedMenuEnabled: boolean;
  advancedAnalyticsEnabled: boolean;
  customerInsightsEnabled: boolean;
  features: string[];
  unavailableFeatures: string[];
  isPopular: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const PlanSchema = new Schema<IPlan>(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true
    },
    description: {
      type: String,
      default: ""
    },
    priceMonthly: {
      type: Number,
      required: true,
      min: 0
    },
    priceYearly: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    restaurantLimit: {
      type: Number,
      required: true,
      min: -1,
      default: -1 // -1 means unlimited
    },
    tableLimit: {
      type: Number,
      required: true,
      min: -1,
      default: -1
    },
    menuItemLimit: {
      type: Number,
      required: true,
      min: -1,
      default: -1
    },
    staffLimit: {
      type: Number,
      required: true,
      min: -1,
      default: -1
    },
    scanLimitMonthly: {
      type: Number,
      required: true,
      default: -1
    },
    fitScoreEnabled: {
      type: Boolean,
      default: false
    },
    foodAttributesEnabled: {
      type: Boolean,
      default: false
    },
    recommendationEnabled: {
      type: Boolean,
      default: false
    },
    personalizedMenuEnabled: {
      type: Boolean,
      default: false
    },
    advancedAnalyticsEnabled: {
      type: Boolean,
      default: false
    },
    customerInsightsEnabled: {
      type: Boolean,
      default: false
    },
    features: {
      type: [String],
      default: []
    },
    unavailableFeatures: {
      type: [String],
      default: []
    },
    isPopular: {
      type: Boolean,
      default: false
    },
    isActive: {
      type: Boolean,
      default: true
    },
    sortOrder: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

export const Plan = mongoose.model<IPlan>("Plan", PlanSchema);
