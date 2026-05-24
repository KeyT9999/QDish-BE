import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICategory extends Document {
  restaurantId: Types.ObjectId;
  name: string;
}

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
    }
  },
  { timestamps: true }
);

CategorySchema.index({ restaurantId: 1, name: 1 }, { unique: true });

export const Category = mongoose.model<ICategory>("Category", CategorySchema);


