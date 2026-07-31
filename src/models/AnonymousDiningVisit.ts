import mongoose, { Document, Schema, Types } from "mongoose";

export enum AnonymousDiningVisitSource {
  ONBOARDING = "ONBOARDING"
}

export interface IAnonymousDiningVisit extends Document {
  restaurantId: Types.ObjectId;
  tableSessionId: Types.ObjectId;
  visitToken: string;
  goalsSnapshot: string[];
  dietaryPreferencesSnapshot: string[];
  source: AnonymousDiningVisitSource;
  recordedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AnonymousDiningVisitSchema = new Schema<IAnonymousDiningVisit>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true
    },
    tableSessionId: {
      type: Schema.Types.ObjectId,
      ref: "TableSession",
      required: true
    },
    visitToken: {
      type: String,
      required: true,
      trim: true
    },
    goalsSnapshot: {
      type: [String],
      default: []
    },
    dietaryPreferencesSnapshot: {
      type: [String],
      default: []
    },
    source: {
      type: String,
      enum: Object.values(AnonymousDiningVisitSource),
      default: AnonymousDiningVisitSource.ONBOARDING,
      required: true
    },
    recordedAt: {
      type: Date,
      default: Date.now,
      required: true
    }
  },
  { timestamps: true }
);

AnonymousDiningVisitSchema.index(
  { restaurantId: 1, tableSessionId: 1, visitToken: 1 },
  { unique: true }
);
AnonymousDiningVisitSchema.index({ restaurantId: 1, recordedAt: -1 });

export const AnonymousDiningVisit = mongoose.model<IAnonymousDiningVisit>(
  "AnonymousDiningVisit",
  AnonymousDiningVisitSchema
);
