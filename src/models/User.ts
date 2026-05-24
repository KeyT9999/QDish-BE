import mongoose, { Schema, Document, Types } from "mongoose";

export enum UserRole {
  SUPER_ADMIN = "SUPER_ADMIN",
  RESTAURANT_ADMIN = "RESTAURANT_ADMIN",
  STAFF = "STAFF"
}

export interface IUser extends Document {
  username: string;
  passwordHash: string;
  role: UserRole;
  restaurantId?: Types.ObjectId;
  isActive?: boolean;
  name?: string; // Tên nhân viên
  updatedBy?: Types.ObjectId; // Admin nào tạo/cập nhật
}

const UserSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    passwordHash: {
      type: String,
      required: true
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      required: true
    },
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant"
    },
    isActive: {
      type: Boolean,
      default: true
    },
    name: {
      type: String,
      trim: true
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    }
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema);

