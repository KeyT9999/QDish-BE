import mongoose, { Schema, Document, Types } from "mongoose";

export interface IEmailChangeToken extends Document {
  restaurantId: Types.ObjectId;
  newEmail: string;
  otp: string;
  expiresAt: Date;
  used: boolean;
}

const EmailChangeTokenSchema = new Schema<IEmailChangeToken>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true
    },
    newEmail: {
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
    used: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

export const EmailChangeToken = mongoose.model<IEmailChangeToken>(
  "EmailChangeToken",
  EmailChangeTokenSchema
);

