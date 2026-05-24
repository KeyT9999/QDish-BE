import mongoose, { Schema, Document, Types } from "mongoose";

export interface ITable extends Document {
  restaurantId: Types.ObjectId;
  code: string; // số bàn / ký hiệu bàn, ví dụ: "5", "VIP1"
  isActive: boolean;
}

const TableSchema = new Schema<ITable>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true
    },
    code: {
      type: String,
      required: true,
      trim: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

TableSchema.index({ restaurantId: 1, code: 1 }, { unique: true });

export const Table = mongoose.model<ITable>("Table", TableSchema);


