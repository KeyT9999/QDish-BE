import mongoose, { Schema, Document, Types } from "mongoose";
import type { CategoryTranslationValue, CategoryTranslations, TranslationEntry } from "./MenuTranslation.js";

export interface ICategory extends Document {
  restaurantId: Types.ObjectId;
  name: string;
  translations?: CategoryTranslations;
}

const CategoryTranslationValueSchema = new Schema<CategoryTranslationValue>({
  name: { type: String, required: true, trim: true, maxlength: 200 }
}, { _id: false });

const CategoryApprovedTranslationSchema = new Schema<NonNullable<TranslationEntry<CategoryTranslationValue>["approved"]>>({
  value: { type: CategoryTranslationValueSchema, required: true },
  status: { type: String, enum: ["APPROVED", "STALE"], required: true }
}, { _id: false });

const CategoryDraftTranslationSchema = new Schema<NonNullable<TranslationEntry<CategoryTranslationValue>["draft"]>>({
  value: { type: CategoryTranslationValueSchema, required: true },
  generatedAt: { type: Date, required: true }
}, { _id: false });

const CategoryTranslationEntrySchema = new Schema<TranslationEntry<CategoryTranslationValue>>({
  approved: { type: CategoryApprovedTranslationSchema, default: undefined },
  draft: { type: CategoryDraftTranslationSchema, default: undefined }
}, { _id: false });

const CategoryTranslationsSchema = new Schema({
  en: { type: CategoryTranslationEntrySchema, default: undefined },
  zhCN: { type: CategoryTranslationEntrySchema, default: undefined }
}, { _id: false });

const CategorySchema = new Schema<ICategory>(
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
    translations: {
      type: CategoryTranslationsSchema,
      default: undefined
    }
  },
  { timestamps: true }
);

CategorySchema.index({ restaurantId: 1, name: 1 }, { unique: true });

export const Category = mongoose.model<ICategory>("Category", CategorySchema);


