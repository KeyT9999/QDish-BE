import mongoose, { Schema, Document, Types } from "mongoose";

export enum OrderStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  SERVED = "SERVED",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED"
}

export enum PaymentMethod {
  CASH = "CASH",
  BANK_TRANSFER = "BANK_TRANSFER",
  PAYOS = "PAYOS",
  UNKNOWN = "UNKNOWN"
}

export interface IOrderItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface IOrder extends Document {
  restaurantId: Types.ObjectId;
  tableNumber: string;
  tableSessionId?: Types.ObjectId;
  billId?: Types.ObjectId;
  sessionCode?: string;
  billCode?: string;
  billStatus?: string;
  items: IOrderItem[];
  totalAmount: number;
  status: OrderStatus;
  note?: string;
  customerName?: string;
  paymentMethod?: PaymentMethod;
  confirmedBy?: Types.ObjectId;
  confirmedByName?: string;
  updatedBy?: Types.ObjectId;
  updatedByName?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const OrderItemSchema = new Schema<IOrderItem>({
  menuItemId: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 }
});

const OrderSchema = new Schema<IOrder>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true
    },
    tableNumber: {
      type: String,
      required: true
    },
    tableSessionId: {
      type: Schema.Types.ObjectId,
      ref: "TableSession",
      index: true
    },
    billId: {
      type: Schema.Types.ObjectId,
      ref: "Bill",
      index: true
    },
    sessionCode: {
      type: String,
      trim: true
    },
    billCode: {
      type: String,
      trim: true
    },
    billStatus: {
      type: String,
      trim: true
    },
    items: {
      type: [OrderItemSchema],
      required: true
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: Object.values(OrderStatus),
      default: OrderStatus.PENDING,
      required: true
    },
    note: {
      type: String,
      trim: true
    },
    customerName: {
      type: String,
      trim: true
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
      required: false
    },
    confirmedBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    confirmedByName: {
      type: String,
      trim: true
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    updatedByName: {
      type: String,
      trim: true
    }
  },
  { timestamps: true }
);

OrderSchema.index({ restaurantId: 1, createdAt: -1 });
OrderSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ restaurantId: 1, tableNumber: 1, createdAt: -1 });
OrderSchema.index({ tableSessionId: 1, createdAt: -1 });
OrderSchema.index({ billId: 1, createdAt: -1 });

export const Order = mongoose.model<IOrder>("Order", OrderSchema);
