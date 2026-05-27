import mongoose, { Schema, Document, Types } from "mongoose";

export enum BillStatus {
  UNPAID = "UNPAID",
  PAYMENT_REQUESTED = "PAYMENT_REQUESTED",
  PAID = "PAID",
  CANCELLED = "CANCELLED"
}

export enum BillPaymentMethod {
  CASH = "CASH",
  BANK_TRANSFER = "BANK_TRANSFER",
  PAYOS = "PAYOS",
  UNKNOWN = "UNKNOWN"
}

export interface IBillItemSnapshot {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes?: string;
}

export interface IBill extends Document {
  restaurantId: Types.ObjectId;
  tableSessionId: Types.ObjectId;
  tableNumber: string;
  billCode: string;
  status: BillStatus;
  orderIds: Types.ObjectId[];
  itemsSnapshot: IBillItemSnapshot[];
  subtotal: number;
  discountAmount: number;
  serviceFee: number;
  taxAmount: number;
  totalAmount: number;
  totalItems: number;
  paymentMethod: BillPaymentMethod;
  cashReceived?: number;
  changeAmount?: number;
  paidBy?: Types.ObjectId;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BillItemSnapshotSchema = new Schema<IBillItemSnapshot>(
  {
    menuItemId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true }
  },
  { _id: false }
);

const BillSchema = new Schema<IBill>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true
    },
    tableSessionId: {
      type: Schema.Types.ObjectId,
      ref: "TableSession",
      required: true,
      index: true
    },
    tableNumber: {
      type: String,
      required: true,
      trim: true
    },
    billCode: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: Object.values(BillStatus),
      default: BillStatus.UNPAID,
      required: true
    },
    orderIds: [{
      type: Schema.Types.ObjectId,
      ref: "Order"
    }],
    itemsSnapshot: {
      type: [BillItemSnapshotSchema],
      default: []
    },
    subtotal: {
      type: Number,
      default: 0,
      min: 0
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    serviceFee: {
      type: Number,
      default: 0,
      min: 0
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    totalAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    totalItems: {
      type: Number,
      default: 0,
      min: 0
    },
    paymentMethod: {
      type: String,
      enum: Object.values(BillPaymentMethod),
      default: BillPaymentMethod.UNKNOWN,
      required: true
    },
    cashReceived: {
      type: Number,
      min: 0
    },
    changeAmount: {
      type: Number,
      min: 0
    },
    paidBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    paidAt: {
      type: Date
    }
  },
  { timestamps: true }
);

BillSchema.index({ restaurantId: 1, billCode: 1 }, { unique: true });
BillSchema.index({ restaurantId: 1, createdAt: -1 });
BillSchema.index({ restaurantId: 1, tableNumber: 1, createdAt: -1 });
BillSchema.index(
  { tableSessionId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [BillStatus.UNPAID, BillStatus.PAYMENT_REQUESTED] }
    }
  }
);

export const generateBillCode = (tableNumber: string): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const sec = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `B${tableNumber}-${y}${m}${d}-${h}${min}${sec}${ms}-${suffix}`;
};

export const Bill = mongoose.model<IBill>("Bill", BillSchema);
