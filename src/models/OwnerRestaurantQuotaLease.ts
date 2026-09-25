import mongoose, { Schema, Document, Types } from "mongoose";

interface IOwnerRestaurantQuotaLease extends Document {
  _id: Types.ObjectId;
  token?: string;
  expiresAt?: Date;
  reservationToken?: string;
  reservationExpiresAt?: Date;
}

const OwnerRestaurantQuotaLeaseSchema = new Schema<IOwnerRestaurantQuotaLease>({
  _id: { type: Schema.Types.ObjectId, required: true, ref: "User" },
  token: { type: String },
  expiresAt: { type: Date },
  reservationToken: { type: String },
  reservationExpiresAt: { type: Date }
}, { collection: "owner_restaurant_quota_leases" });

export const OwnerRestaurantQuotaLease = mongoose.model<IOwnerRestaurantQuotaLease>(
  "OwnerRestaurantQuotaLease",
  OwnerRestaurantQuotaLeaseSchema
);
