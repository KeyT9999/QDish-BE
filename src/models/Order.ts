import mongoose, { Schema, Document, Types } from "mongoose";

export enum OrderStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  SERVED = "SERVED",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED"
}

export enum PaymentMethod {
  CASH = "CASH", // Tiền mặt
  BANK_TRANSFER = "BANK_TRANSFER" // Chuyển khoản
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
  items: IOrderItem[];
  totalAmount: number;
  status: OrderStatus;
  note?: string;
  customerName?: string; // Tên khách hàng
  paymentMethod?: PaymentMethod; // Hình thức thanh toán
  confirmedBy?: Types.ObjectId; // ID nhân viên đã xác nhận đơn
  confirmedByName?: string; // Tên nhân viên đã xác nhận (để hiển thị nhanh)
  updatedBy?: Types.ObjectId; // ID người cập nhật đơn hàng (bất kỳ trạng thái nào)
  updatedByName?: string; // Tên người cập nhật đơn hàng (để hiển thị nhanh)
  createdAt?: Date; // Tự động tạo bởi Mongoose timestamps
  updatedAt?: Date; // Tự động tạo bởi Mongoose timestamps
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

export const Order = mongoose.model<IOrder>("Order", OrderSchema);

