import mongoose, { Schema, Document, Types } from "mongoose";

export interface IPasswordResetToken extends Document {
  email: string;
  otp: string;
  expiresAt: Date;
  restaurantId?: Types.ObjectId;
  used: boolean;
}

const PasswordResetTokenSchema = new Schema<IPasswordResetToken>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    otp: {
      type: String,
      required: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 } // Tự động xóa sau khi hết hạn
    },
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant"
    },
    used: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

export const PasswordResetToken = mongoose.model<IPasswordResetToken>(
  "PasswordResetToken",
  PasswordResetTokenSchema
);

