import mongoose, { Document, Schema, Types } from "mongoose";

export const DEMO_DINING_GOALS = [
  "MUSCLE_GAIN",
  "ENERGY_BOOST",
  "LIGHT_MEAL",
  "COMFORT",
  "BALANCED",
  "WEIGHT_LOSS"
] as const;

export const DEMO_DIETARY_PREFERENCES = [
  "VEGETARIAN",
  "VEGAN",
  "LOW_CARB",
  "HIGH_PROTEIN",
  "KETO",
  "SUGAR_FREE"
] as const;

export interface IMerchantInsightDemoSurvey extends Document {
  restaurantId: Types.ObjectId;
  batchId: string;
  responseKey: string;
  goalsSnapshot: string[];
  dietaryPreferencesSnapshot: string[];
  source: "DEMO_SEED";
  recordedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MerchantInsightDemoSurveySchema = new Schema<IMerchantInsightDemoSurvey>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true
    },
    batchId: {
      type: String,
      required: true,
      trim: true,
      immutable: true
    },
    responseKey: {
      type: String,
      required: true,
      trim: true,
      immutable: true
    },
    goalsSnapshot: {
      type: [{ type: String, enum: DEMO_DINING_GOALS }],
      default: []
    },
    dietaryPreferencesSnapshot: {
      type: [{ type: String, enum: DEMO_DIETARY_PREFERENCES }],
      default: []
    },
    source: {
      type: String,
      enum: ["DEMO_SEED"],
      default: "DEMO_SEED",
      required: true,
      immutable: true
    },
    recordedAt: {
      type: Date,
      required: true
    }
  },
  {
    timestamps: true,
    autoCreate: false,
    autoIndex: false
  }
);

MerchantInsightDemoSurveySchema.index(
  { restaurantId: 1, batchId: 1, responseKey: 1 },
  { unique: true }
);
MerchantInsightDemoSurveySchema.index({ restaurantId: 1, recordedAt: -1 });

export const MerchantInsightDemoSurvey = mongoose.model<IMerchantInsightDemoSurvey>(
  "MerchantInsightDemoSurvey",
  MerchantInsightDemoSurveySchema
);
