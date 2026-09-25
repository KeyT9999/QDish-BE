import mongoose, { Document, Schema, Types } from "mongoose";

export interface IRestaurantCustomer extends Document {
  restaurantId: Types.ObjectId;
  displayName: string;
  phoneCiphertext: string;
  phoneLookupHash: string;
  phoneLast4: string;
  marketingConsent: boolean;
  consentAt?: Date;
  consentSource?: string;
  consentVersion?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  visitCount: number;
  orderCount: number;
  totalSpend: number;
  processedOrderStatsKeys?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const RestaurantCustomerSchema = new Schema<IRestaurantCustomer>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    phoneCiphertext: {
      type: String,
      required: true,
      select: false
    },
    phoneLookupHash: {
      type: String,
      required: true,
      select: false
    },
    phoneLast4: {
      type: String,
      required: true
    },
    marketingConsent: {
      type: Boolean,
      default: false,
      required: true
    },
    consentAt: Date,
    consentSource: { type: String, trim: true },
    consentVersion: { type: String, trim: true },
    firstSeenAt: { type: Date, default: Date.now, required: true },
    lastSeenAt: { type: Date, default: Date.now, required: true },
    visitCount: { type: Number, default: 0, min: 0 },
    orderCount: { type: Number, default: 0, min: 0 },
    totalSpend: { type: Number, default: 0, min: 0 },
    processedOrderStatsKeys: { type: [String], select: false, default: undefined }
  },
  { timestamps: true }
);

RestaurantCustomerSchema.index(
  { restaurantId: 1, phoneLookupHash: 1 },
  { unique: true }
);
RestaurantCustomerSchema.index({ restaurantId: 1, lastSeenAt: -1 });
RestaurantCustomerSchema.index({ restaurantId: 1, displayName: 1 });

export const RestaurantCustomer = mongoose.model<IRestaurantCustomer>(
  "RestaurantCustomer",
  RestaurantCustomerSchema
);
