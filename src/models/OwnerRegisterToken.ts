import mongoose, { Schema, Document } from "mongoose";

export interface IOwnerRegisterToken extends Document {
  email: string;
  fullName: string;
  phone: string;
  username: string;
  passwordHash: string;
  otp: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const OwnerRegisterTokenSchema = new Schema<IOwnerRegisterToken>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true
    },
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true
    },
    username: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    passwordHash: {
      type: String,
      required: true
    },
    otp: {
      type: String,
      required: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 } // Automatically deletes document after expiresAt
    },
    used: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

export const OwnerRegisterToken = mongoose.model<IOwnerRegisterToken>(
  "OwnerRegisterToken",
  OwnerRegisterTokenSchema
);
