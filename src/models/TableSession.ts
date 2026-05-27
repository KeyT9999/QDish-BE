import mongoose, { Schema, Document, Types } from "mongoose";

export enum TableSessionStatus {
  OPEN = "OPEN",
  PAYMENT_REQUESTED = "PAYMENT_REQUESTED",
  PAID = "PAID",
  CLOSED = "CLOSED",
  CANCELLED = "CANCELLED"
}

export enum SessionCreatedBy {
  CUSTOMER_SCAN = "CUSTOMER_SCAN",
  STAFF = "STAFF",
  SYSTEM = "SYSTEM"
}

export interface ITableSession extends Document {
  restaurantId: Types.ObjectId;
  tableId: Types.ObjectId;
  tableNumber: string;
  sessionCode: string;
  billId?: Types.ObjectId;
  status: TableSessionStatus;
  customerName?: string;
  customerPhone?: string;
  openedAt: Date;
  closedAt?: Date;
  paidAt?: Date;
  totalAmount: number;
  orderCount: number;
  createdBy: SessionCreatedBy;
  closedBy?: Types.ObjectId;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const TableSessionSchema = new Schema<ITableSession>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true
    },
    tableId: {
      type: Schema.Types.ObjectId,
      ref: "Table",
      required: true
    },
    tableNumber: {
      type: String,
      required: true,
      trim: true
    },
    sessionCode: {
      type: String,
      required: true,
      trim: true
    },
    billId: {
      type: Schema.Types.ObjectId,
      ref: "Bill"
    },
    status: {
      type: String,
      enum: Object.values(TableSessionStatus),
      default: TableSessionStatus.OPEN,
      required: true
    },
    customerName: {
      type: String,
      trim: true
    },
    customerPhone: {
      type: String,
      trim: true
    },
    openedAt: {
      type: Date,
      default: Date.now,
      required: true
    },
    closedAt: {
      type: Date
    },
    paidAt: {
      type: Date
    },
    totalAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    orderCount: {
      type: Number,
      default: 0,
      min: 0
    },
    createdBy: {
      type: String,
      enum: Object.values(SessionCreatedBy),
      default: SessionCreatedBy.CUSTOMER_SCAN,
      required: true
    },
    closedBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    metadata: {
      type: Schema.Types.Mixed
    }
  },
  { timestamps: true }
);

// Partial unique index: chỉ cho phép 1 OPEN session per restaurant+table
TableSessionSchema.index(
  { restaurantId: 1, tableNumber: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "OPEN" }
  }
);

// Lookup by sessionCode
TableSessionSchema.index({ restaurantId: 1, sessionCode: 1 }, { unique: true });

// Query history
TableSessionSchema.index({ restaurantId: 1, createdAt: -1 });

// Lookup by tableId
TableSessionSchema.index({ tableId: 1, status: 1 });

/**
 * Generate a human-readable session code.
 * Format: T{tableNumber}-{YYYYMMDD}-{HHmm}
 * Example: T15-20260527-1730
 */
export const generateSessionCode = (tableNumber: string): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const sec = String(now.getSeconds()).padStart(2, "0");
  return `T${tableNumber}-${y}${m}${d}-${h}${min}${sec}`;
};

export const TableSession = mongoose.model<ITableSession>(
  "TableSession",
  TableSessionSchema
);
