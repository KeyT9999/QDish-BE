import mongoose, { Schema, Document, Types } from "mongoose";

export enum NotificationType {
  INFO = "INFO",
  SUCCESS = "SUCCESS",
  WARNING = "WARNING",
  ERROR = "ERROR",
  ORDER = "ORDER",
  SUBSCRIPTION = "SUBSCRIPTION",
  PAYMENT = "PAYMENT",
  SYSTEM = "SYSTEM"
}

export enum NotificationPriority {
  LOW = "LOW",
  NORMAL = "NORMAL",
  HIGH = "HIGH",
  URGENT = "URGENT"
}

export enum NotificationSource {
  MANUAL = "MANUAL",
  AUTO = "AUTO"
}

export enum SenderRole {
  SUPER_ADMIN = "SUPER_ADMIN",
  RESTAURANT_OWNER = "RESTAURANT_OWNER",
  RESTAURANT_ADMIN = "RESTAURANT_ADMIN",
  SYSTEM = "SYSTEM"
}

export enum TargetType {
  ALL_OWNERS = "ALL_OWNERS",
  OWNER = "OWNER",
  ALL_RESTAURANTS = "ALL_RESTAURANTS",
  RESTAURANT = "RESTAURANT",
  OWNER_RESTAURANTS = "OWNER_RESTAURANTS",
  OWNER_STAFF = "OWNER_STAFF",
  RESTAURANT_STAFF = "RESTAURANT_STAFF",
  USER = "USER",
  ROLE = "ROLE"
}

export interface INotification extends Document {
  title: string;
  message: string;
  type: NotificationType;
  priority: NotificationPriority;
  source: NotificationSource;
  senderId?: Types.ObjectId;
  senderRole: SenderRole;
  targetType: TargetType;
  targetIds: Types.ObjectId[];
  restaurantId?: Types.ObjectId;
  ownerId?: Types.ObjectId;
  orderId?: Types.ObjectId;
  subscriptionId?: Types.ObjectId;
  paymentTransactionId?: Types.ObjectId;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000
    },
    type: {
      type: String,
      enum: Object.values(NotificationType),
      required: true
    },
    priority: {
      type: String,
      enum: Object.values(NotificationPriority),
      default: NotificationPriority.NORMAL
    },
    source: {
      type: String,
      enum: Object.values(NotificationSource),
      required: true
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    senderRole: {
      type: String,
      enum: Object.values(SenderRole),
      required: true
    },
    targetType: {
      type: String,
      enum: Object.values(TargetType),
      required: true
    },
    targetIds: [
      {
        type: Schema.Types.ObjectId
      }
    ],
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant"
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order"
    },
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Subscription"
    },
    paymentTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "PaymentTransaction"
    },
    actionUrl: {
      type: String,
      trim: true
    },
    metadata: {
      type: Schema.Types.Mixed
    }
  },
  { timestamps: true }
);

NotificationSchema.index({ createdAt: -1 });
NotificationSchema.index({ senderId: 1 });
NotificationSchema.index({ targetType: 1 });

export const Notification = mongoose.model<INotification>("Notification", NotificationSchema);
