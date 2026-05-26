import mongoose, { Schema, Document, Types } from "mongoose";

export interface INotificationRecipient extends Document {
  notificationId: Types.ObjectId;
  recipientUserId: Types.ObjectId;
  recipientRole: string;
  ownerId?: Types.ObjectId;
  restaurantId?: Types.ObjectId;
  isRead: boolean;
  readAt?: Date;
  isArchived: boolean;
  deliveredAt: Date;
  createdAt: Date;
}

const NotificationRecipientSchema = new Schema<INotificationRecipient>(
  {
    notificationId: {
      type: Schema.Types.ObjectId,
      ref: "Notification",
      required: true
    },
    recipientUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    recipientRole: {
      type: String,
      required: true
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant"
    },
    isRead: {
      type: Boolean,
      default: false
    },
    readAt: {
      type: Date
    },
    isArchived: {
      type: Boolean,
      default: false
    },
    deliveredAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

// Primary query index: user's notifications sorted by date
NotificationRecipientSchema.index({ recipientUserId: 1, isRead: 1, createdAt: -1 });
NotificationRecipientSchema.index({ recipientUserId: 1, isArchived: 1, createdAt: -1 });
// Prevent duplicate recipients
NotificationRecipientSchema.index({ notificationId: 1, recipientUserId: 1 }, { unique: true });

export const NotificationRecipient = mongoose.model<INotificationRecipient>(
  "NotificationRecipient",
  NotificationRecipientSchema
);
