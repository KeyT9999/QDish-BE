import mongoose, { Schema, Document, Types } from "mongoose";
import type { MenuItemTranslationValue, MenuItemTranslations, TranslationEntry } from "./MenuTranslation.js";

export interface IDishIngredient {
  ingredientId: Types.ObjectId;
  quantity: number;
  unit: 'g' | 'ml' | 'piece' | 'tbsp' | 'tsp' | 'cup' | 'bowl';
  gramsResolved: number;
}

export interface IMenuItem extends Document {
  restaurantId: Types.ObjectId;
  name: string;
  description: string;
  price: number;
  category: string;
  categoryId?: Types.ObjectId;
  translations?: MenuItemTranslations;
  imageUrl: string;
  available: boolean;
  
  // QDish core recipe fields
  ingredients: IDishIngredient[];
  servingCount: number;
  servingSizeGrams: number;
  cookingMethod: string;
  
  // QDish computed cache fields (fallback / populated inline)
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  confidenceScore?: number;
  nutritionCompleteness?: number;
  nutritionComplete?: boolean;
  missingIngredientCount?: number;
  allergens?: string[];
  allergenInfoStatus: "UNKNOWN" | "REVIEWED";
  allergenCoverageStatus: "UNKNOWN" | "INCOMPLETE" | "COMPLETE";
  allergenUnverifiedIngredientCount: number;
  reviewedAllergens: string[];
  mayContainAllergens: string[];
  allergenReviewMethod?: "RECIPE" | "MANUAL";
  allergenReviewSourceType?: "SUPPLIER_LABEL" | "RESTAURANT_RECIPE" | "STAFF_ATTESTATION" | "CURATED_MENU_DESCRIPTION";
  allergenReviewSourceNote?: string;
  allergenReviewedBy?: Types.ObjectId;
  allergenReviewedAt?: Date;
  foodAttributes?: string[];
}

const DishIngredientSchema = new Schema<IDishIngredient>({
  ingredientId: {
    type: Schema.Types.ObjectId,
    ref: "Ingredient",
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 0.01
  },
  unit: {
    type: String,
    enum: ['g', 'ml', 'piece', 'tbsp', 'tsp', 'cup', 'bowl'],
    required: true
  },
  gramsResolved: {
    type: Number,
    required: true,
    min: 0
  }
}, { _id: false });

const MenuItemTranslationValueSchema = new Schema<MenuItemTranslationValue>({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, trim: true, maxlength: 2000, default: "" }
}, { _id: false });

const MenuItemApprovedTranslationSchema = new Schema<NonNullable<TranslationEntry<MenuItemTranslationValue>["approved"]>>({
  value: { type: MenuItemTranslationValueSchema, required: true },
  status: { type: String, enum: ["APPROVED", "STALE"], required: true }
}, { _id: false });

const MenuItemDraftTranslationSchema = new Schema<NonNullable<TranslationEntry<MenuItemTranslationValue>["draft"]>>({
  value: { type: MenuItemTranslationValueSchema, required: true },
  generatedAt: { type: Date, required: true }
}, { _id: false });

const MenuItemTranslationEntrySchema = new Schema<TranslationEntry<MenuItemTranslationValue>>({
  approved: { type: MenuItemApprovedTranslationSchema, default: undefined },
  draft: { type: MenuItemDraftTranslationSchema, default: undefined }
}, { _id: false });

const MenuItemTranslationsSchema = new Schema({
  en: { type: MenuItemTranslationEntrySchema, default: undefined },
  zhCN: { type: MenuItemTranslationEntrySchema, default: undefined }
}, { _id: false });

const MenuItemSchema = new Schema<IMenuItem>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true,
      default: ""
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    category: {
      type: String,
      required: true,
      trim: true
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: false
    },
    translations: {
      type: MenuItemTranslationsSchema,
      default: undefined
    },
    imageUrl: {
      type: String,
      trim: true,
      default: ""
    },
    available: {
      type: Boolean,
      default: true
    },
    
    // QDish Core Recipe fields
    ingredients: {
      type: [DishIngredientSchema],
      default: []
    },
    servingCount: {
      type: Number,
      default: 1,
      min: 1
    },
    servingSizeGrams: {
      type: Number,
      default: 0,
      min: 0
    },
    cookingMethod: {
      type: String,
      default: "raw"
    },
    
    // QDish computed fields cache
    calories: {
      type: Number,
      default: 0,
      min: 0
    },
    protein: {
      type: Number,
      default: 0,
      min: 0
    },
    carbs: {
      type: Number,
      default: 0,
      min: 0
    },
    fat: {
      type: Number,
      default: 0,
      min: 0
    },
    fiber: {
      type: Number,
      default: 0,
      min: 0
    },
    sugar: {
      type: Number,
      default: 0,
      min: 0
    },
    sodium: {
      type: Number,
      default: 0,
      min: 0
    },
    confidenceScore: {
      type: Number,
      default: 0,
      min: 0
    },
    nutritionCompleteness: {
      type: Number,
      default: 0,
      min: 0,
      max: 1
    },
    nutritionComplete: {
      type: Boolean,
      default: false
    },
    missingIngredientCount: {
      type: Number,
      default: 0,
      min: 0
    },
    allergens: {
      type: [String],
      default: []
    },
    allergenInfoStatus: {
      type: String,
      enum: ["UNKNOWN", "REVIEWED"],
      default: "UNKNOWN",
      required: true
    },
    allergenCoverageStatus: {
      type: String,
      enum: ["UNKNOWN", "INCOMPLETE", "COMPLETE"],
      default: "UNKNOWN",
      required: true
    },
    allergenUnverifiedIngredientCount: { type: Number, default: 0, min: 0 },
    reviewedAllergens: { type: [String], default: [] },
    mayContainAllergens: { type: [String], default: [] },
    allergenReviewMethod: { type: String, enum: ["RECIPE", "MANUAL"] },
    allergenReviewSourceType: {
      type: String,
      enum: ["SUPPLIER_LABEL", "RESTAURANT_RECIPE", "STAFF_ATTESTATION", "CURATED_MENU_DESCRIPTION"]
    },
    allergenReviewSourceNote: { type: String, trim: true, maxlength: 500 },
    allergenReviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    allergenReviewedAt: { type: Date },
    foodAttributes: {
      type: [String],
      default: []
    }
  },
  { timestamps: true }
);

MenuItemSchema.index({ restaurantId: 1, available: 1, createdAt: -1 });
MenuItemSchema.index({ restaurantId: 1, categoryId: 1, createdAt: -1 });

export const MenuItem = mongoose.model<IMenuItem>("MenuItem", MenuItemSchema);
