import mongoose, { Schema, Document, Types } from "mongoose";

export interface IDishNutritionProfile extends Document {
  dishId: Types.ObjectId;
  restaurantId: Types.ObjectId;
  calories: number;
  protein: number;
  carb: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number; // in mg
  attributes: string[];
  allergens: string[];
  nutritionConfidence: number;
  fitScores: Record<string, number>;
  bestFitContext: string;
  calculatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DishNutritionProfileSchema = new Schema<IDishNutritionProfile>(
  {
    dishId: { type: Schema.Types.ObjectId, ref: "MenuItem", required: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    calories: { type: Number, required: true, min: 0 },
    protein: { type: Number, required: true, min: 0 },
    carb: { type: Number, required: true, min: 0 },
    fat: { type: Number, required: true, min: 0 },
    fiber: { type: Number, default: 0, min: 0 },
    sugar: { type: Number, default: 0, min: 0 },
    sodium: { type: Number, default: 0, min: 0 },
    attributes: { type: [String], default: [] },
    allergens: { type: [String], default: [] },
    nutritionConfidence: { type: Number, default: 1.0, min: 0, max: 1.0 },
    fitScores: { type: Map, of: Number, default: {} },
    bestFitContext: { type: String, default: "" },
    calculatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

DishNutritionProfileSchema.index(
  { dishId: 1 },
  {
    name: "dishId_1",
    unique: true,
    partialFilterExpression: { dishId: { $type: "objectId" } }
  }
);
DishNutritionProfileSchema.index({ restaurantId: 1, calories: 1 });
DishNutritionProfileSchema.index({ restaurantId: 1, protein: -1 });

export const DishNutritionProfile = mongoose.model<IDishNutritionProfile>("DishNutritionProfile", DishNutritionProfileSchema);
