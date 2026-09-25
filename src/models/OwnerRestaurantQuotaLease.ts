import mongoose, { Schema, Document, Types } from "mongoose";

interface IOwnerRestaurantQuotaLease extends Document {
  _id: Types.ObjectId;
  token: string;
  expiresAt: Date;
}

const OwnerRestaurantQuotaLeaseSchema = new Schema<IOwnerRestaurantQuotaLease>({
  _id: { type: Schema.Types.ObjectId, required: true, ref: "User" },
  token: { type: String, required: true },
  expiresAt: { type: Date, required: true }
}, { collection: "owner_restaurant_quota_leases" });

export const OwnerRestaurantQuotaLease = mongoose.model<IOwnerRestaurantQuotaLease>(
  "OwnerRestaurantQuotaLease",
  OwnerRestaurantQuotaLeaseSchema
);
