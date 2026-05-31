import mongoose, { Schema, Document, Types } from "mongoose";

export interface IIngredient extends Document {
  name: string;
  slug: string;
  category: string;
  defaultUnit: 'g' | 'ml' | 'piece';
  gramsPerUnit: number;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbPer100g: number;
  fatPer100g: number;
  fiberPer100g: number;
  sugarPer100g: number;
  sodiumPer100g: number; // in mg
  allergens: string[];
  attributes: string[];
  isVerified: boolean;
  restaurantId: Types.ObjectId | null;
  source: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const IngredientSchema = new Schema<IIngredient>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    category: { type: String, required: true, index: true },
    defaultUnit: { type: String, enum: ['g', 'ml', 'piece'], default: 'g' },
    gramsPerUnit: { type: Number, default: 1 },
    caloriesPer100g: { type: Number, required: true, min: 0 },
    proteinPer100g: { type: Number, required: true, min: 0 },
    carbPer100g: { type: Number, required: true, min: 0 },
    fatPer100g: { type: Number, required: true, min: 0 },
    fiberPer100g: { type: Number, default: 0, min: 0 },
    sugarPer100g: { type: Number, default: 0, min: 0 },
    sodiumPer100g: { type: Number, default: 0, min: 0 },
    allergens: { type: [String], default: [] },
    attributes: { type: [String], default: [] },
    isVerified: { type: Boolean, default: false, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", default: null, index: true },
    source: { type: String, default: "merchant" },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

IngredientSchema.index({ isVerified: 1, restaurantId: 1 });

export const Ingredient = mongoose.model<IIngredient>("Ingredient", IngredientSchema);
