import mongoose, { Schema, Document, Types } from "mongoose";

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
  nutritionScore?: number;
  allergens?: string[];
  healthTags?: string[];
  healthLabels?: string[];
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
    nutritionScore: {
      type: Number,
      default: 0,
      min: 0
    },
    allergens: {
      type: [String],
      default: []
    },
    healthTags: {
      type: [String],
      default: []
    },
    healthLabels: {
      type: [String],
      default: []
    }
  },
  { timestamps: true }
);

MenuItemSchema.index({ restaurantId: 1, available: 1, createdAt: -1 });
MenuItemSchema.index({ restaurantId: 1, categoryId: 1, createdAt: -1 });

export const MenuItem = mongoose.model<IMenuItem>("MenuItem", MenuItemSchema);
