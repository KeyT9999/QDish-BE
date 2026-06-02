import mongoose, { Schema, Document, Types } from "mongoose";

export interface IIngredientAlias extends Document {
  ingredientId: Types.ObjectId;
  alias: string;
  aliasNormalized: string;
  language: 'vi' | 'en';
}

const IngredientAliasSchema = new Schema<IIngredientAlias>(
  {
    ingredientId: { type: Schema.Types.ObjectId, ref: "Ingredient", required: true, index: true },
    alias: { type: String, required: true, trim: true },
    aliasNormalized: { type: String, required: true, trim: true, index: true },
    language: { type: String, enum: ['vi', 'en'], default: 'vi' }
  },
  { timestamps: true }
);

IngredientAliasSchema.index({ aliasNormalized: 1, language: 1 });

export const IngredientAlias = mongoose.model<IIngredientAlias>("IngredientAlias", IngredientAliasSchema);
