import mongoose, { Schema, Document, Types } from "mongoose";

export enum SubscriptionStatus {
  ACTIVE = "ACTIVE",
  PENDING_PAYMENT = "PENDING_PAYMENT",
  EXPIRED = "EXPIRED",
  CANCELLED = "CANCELLED"
}

export enum BillingCycle {
  MONTHLY = "MONTHLY",
  YEARLY = "YEARLY"
}

export interface ISubscription extends Document {
  ownerId: Types.ObjectId;
  planId: Types.ObjectId;
  planCode: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  amount: number;
  startedAt?: Date;
  expiresAt?: Date;
  paymentOrderCode?: number; // PayOS orderCode
  payosPaymentLinkId?: string;
  lastWarningLevel?: string; // Notification dedup: 'none' | '7days' | '3days' | '1day' | 'expired'
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>(
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
    planCode: {
      type: String,
      required: true,
      uppercase: true
    },
    status: {
      type: String,
      enum: Object.values(SubscriptionStatus),
      default: SubscriptionStatus.PENDING_PAYMENT,
      index: true
    },
    billingCycle: {
      type: String,
      enum: Object.values(BillingCycle),
      default: BillingCycle.MONTHLY
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    startedAt: {
      type: Date
    },
    expiresAt: {
      type: Date
    },
    paymentOrderCode: {
      type: Number,
      index: true
    },
    payosPaymentLinkId: {
      type: String
    },
    lastWarningLevel: {
      type: String,
      default: "none"
    }
  },
  { timestamps: true }
);

export const Subscription = mongoose.model<ISubscription>("Subscription", SubscriptionSchema);
