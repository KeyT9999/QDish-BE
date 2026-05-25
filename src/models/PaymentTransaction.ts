import mongoose, { Schema, Document, Types } from "mongoose";

export enum PaymentStatus {
  PENDING = "PENDING",
  PAID = "PAID",
  CANCELLED = "CANCELLED",
  FAILED = "FAILED"
}

export interface IPaymentTransaction extends Document {
  ownerId: Types.ObjectId;
  planId: Types.ObjectId;
  subscriptionId: Types.ObjectId;
  orderCode: number; // PayOS orderCode
  amount: number;
  status: PaymentStatus;
  paymentLinkId?: string;
  checkoutUrl?: string;
  qrCode?: string;
  payosRawResponse?: any;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentTransactionSchema = new Schema<IPaymentTransaction>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: "Plan",
      required: true
    },
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Subscription",
      required: true
    },
    orderCode: {
      type: Number,
      required: true,
      unique: true,
      index: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
      index: true
    },
    paymentLinkId: {
      type: String
    },
    checkoutUrl: {
      type: String
    },
    qrCode: {
      type: String
    },
    payosRawResponse: {
      type: Schema.Types.Mixed
    }
  },
  { timestamps: true }
);

export const PaymentTransaction = mongoose.model<IPaymentTransaction>(
  "PaymentTransaction",
  PaymentTransactionSchema
);
