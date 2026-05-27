import mongoose, { Schema, Document, Types } from "mongoose";

export enum TableStatus {
  AVAILABLE = "AVAILABLE",
  OCCUPIED = "OCCUPIED",
  PAYMENT_PENDING = "PAYMENT_PENDING",
  CLOSED = "CLOSED"
}

export interface ITable extends Document {
  restaurantId: Types.ObjectId;
  code: string; // số bàn / ký hiệu bàn, ví dụ: "5", "VIP1"
  isActive: boolean;
  status: TableStatus;
  activeSessionId?: Types.ObjectId;
  currentSessionCode?: string;
  lastSessionClosedAt?: Date;
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
    },
    status: {
      type: String,
      enum: Object.values(TableStatus),
      default: TableStatus.AVAILABLE
    },
    activeSessionId: {
      type: Schema.Types.ObjectId,
      ref: "TableSession"
    },
    currentSessionCode: {
      type: String,
      trim: true
    },
    lastSessionClosedAt: {
      type: Date
    }
  },
  { timestamps: true }
);

TableSchema.index({ restaurantId: 1, code: 1 }, { unique: true });

export const Table = mongoose.model<ITable>("Table", TableSchema);


