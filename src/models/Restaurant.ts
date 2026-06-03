import mongoose, { Schema, Document, Types } from "mongoose";

export enum RestaurantStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE"
}

export interface IRestaurant extends Document {
  name: string;
  username: string;
  ownerName: string;
  email: string;
  address: string;
  phone: string;
  status: RestaurantStatus;
  active: boolean;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
  bankQrImageUrl?: string;
  bankQrPublicId?: string;
  paymentSettingsUpdatedByOwnerId?: Types.ObjectId;
  paymentSettingsUpdatedAt?: Date;
  bankAccount?: string; // Số tài khoản ngân hàng
  bankName?: string; // Tên ngân hàng
  ownerId?: Types.ObjectId; // ID chủ nhà hàng
}

const RestaurantSchema = new Schema<IRestaurant>(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    ownerName: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    address: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: Object.values(RestaurantStatus),
      default: RestaurantStatus.ACTIVE
    },
    active: {
      type: Boolean,
      default: true
    },
    bankAccount: {
      type: String,
      trim: true
    },
    bankName: {
      type: String,
      trim: true
    },
    bankAccountNumber: {
      type: String,
      trim: true
    },
    bankAccountHolder: {
      type: String,
      trim: true
    },
    bankQrImageUrl: {
      type: String,
      trim: true
    },
    bankQrPublicId: {
      type: String,
      trim: true
    },
    paymentSettingsUpdatedByOwnerId: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    paymentSettingsUpdatedAt: {
      type: Date
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true
    }
  },
  { timestamps: true }
);

export const Restaurant = mongoose.model<IRestaurant>(
  "Restaurant",
  RestaurantSchema
);

