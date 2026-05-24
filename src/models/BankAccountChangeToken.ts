import mongoose, { Schema, Document, Types } from "mongoose";

export interface IBankAccountChangeToken extends Document {
  restaurantId: Types.ObjectId;
  newBankAccount: string;
  newBankName: string;
  otp: string;
  expiresAt: Date;
  used: boolean;
}

const BankAccountChangeTokenSchema = new Schema<IBankAccountChangeToken>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true
    },
    newBankAccount: {
      type: String,
      required: true,
      trim: true
    },
    newBankName: {
      type: String,
      required: true,
      trim: true
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

export const BankAccountChangeToken = mongoose.model<IBankAccountChangeToken>(
  "BankAccountChangeToken",
  BankAccountChangeTokenSchema
);

