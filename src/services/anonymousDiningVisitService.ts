import mongoose, { Types } from "mongoose";

import {
  AnonymousDiningVisit,
  AnonymousDiningVisitSource
} from "../models/AnonymousDiningVisit.js";
import { TableSession, TableSessionStatus } from "../models/TableSession.js";

const VISIT_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SELECTIONS = 10;

const ALLOWED_GOALS = new Set([
  "MUSCLE_GAIN",
  "ENERGY_BOOST",
  "LIGHT_MEAL",
  "COMFORT",
  "BALANCED",
  "WEIGHT_LOSS"
]);

const ALLOWED_PREFERENCES = new Set([
  "VEGETARIAN",
  "VEGAN",
  "LOW_CARB",
  "HIGH_PROTEIN",
  "KETO",
  "SUGAR_FREE"
]);

export interface RecordAnonymousDiningVisitInput {
  restaurantId: unknown;
  tableSessionId: unknown;
  visitToken: unknown;
  goals: unknown;
  dietaryPreferences: unknown;
}

interface TableSessionSummary {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  status: TableSessionStatus;
}

interface UpsertAnonymousDiningVisitInput {
  restaurantId: Types.ObjectId;
  tableSessionId: Types.ObjectId;
  visitToken: string;
  goalsSnapshot: string[];
  dietaryPreferencesSnapshot: string[];
}

interface RecordedAnonymousDiningVisit {
  id: string;
  recordedAt: Date;
  created: boolean;
}

export interface AnonymousDiningVisitDependencies {
  findTableSession: (tableSessionId: Types.ObjectId) => Promise<TableSessionSummary | null>;
  upsertVisit: (input: UpsertAnonymousDiningVisitInput) => Promise<RecordedAnonymousDiningVisit>;
}

export class AnonymousDiningVisitServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: "INVALID_DINING_VISIT" | "TABLE_SESSION_NOT_FOUND" | "TABLE_SESSION_INACTIVE",
    message: string
  ) {
    super(message);
    this.name = "AnonymousDiningVisitServiceError";
  }
}

const invalidInput = (message: string): never => {
  throw new AnonymousDiningVisitServiceError(400, "INVALID_DINING_VISIT", message);
};

const parseObjectId = (value: unknown, fieldName: string): Types.ObjectId => {
  if (typeof value !== "string" || !mongoose.isValidObjectId(value)) {
    return invalidInput(`${fieldName} không hợp lệ`);
  }
  return new mongoose.Types.ObjectId(value);
};

const parseSelections = (
  value: unknown,
  fieldName: string,
  allowedValues: Set<string>
): string[] => {
  if (!Array.isArray(value) || value.length > MAX_SELECTIONS) {
    return invalidInput(`${fieldName} không hợp lệ`);
  }

  const selections: string[] = [];
  for (const selection of value) {
    if (typeof selection !== "string" || !allowedValues.has(selection)) {
      return invalidInput(`${fieldName} chứa giá trị không được hỗ trợ`);
    }
    if (!selections.includes(selection)) {
      selections.push(selection);
    }
  }
  return selections;
};

const defaultDependencies: AnonymousDiningVisitDependencies = {
  findTableSession: async (tableSessionId) => {
    return TableSession.findById(tableSessionId)
      .select("_id restaurantId status")
      .lean<TableSessionSummary>();
  },
  upsertVisit: async (input) => {
    const filter = {
      restaurantId: input.restaurantId,
      tableSessionId: input.tableSessionId,
      visitToken: input.visitToken
    };
    const update = {
      $set: {
        goalsSnapshot: input.goalsSnapshot,
        dietaryPreferencesSnapshot: input.dietaryPreferencesSnapshot,
        source: AnonymousDiningVisitSource.ONBOARDING
      },
      $setOnInsert: {
        recordedAt: new Date()
      }
    };

    let result;
    try {
      result = await AnonymousDiningVisit.updateOne(filter, update, { upsert: true });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      result = await AnonymousDiningVisit.updateOne(filter, update);
    }

    const visit = await AnonymousDiningVisit.findOne(filter)
      .select("_id recordedAt")
      .lean<{ _id: Types.ObjectId; recordedAt: Date }>();
    if (!visit) {
      throw new Error("Anonymous dining visit upsert did not return a record");
    }

    return {
      id: visit._id.toString(),
      recordedAt: visit.recordedAt,
      created: result.upsertedCount === 1
    };
  }
};

export async function recordAnonymousDiningVisit(
  input: RecordAnonymousDiningVisitInput,
  deps: AnonymousDiningVisitDependencies = defaultDependencies
): Promise<RecordedAnonymousDiningVisit> {
  const restaurantId = parseObjectId(input.restaurantId, "restaurantId");
  const tableSessionId = parseObjectId(input.tableSessionId, "tableSessionId");
  if (typeof input.visitToken !== "string" || !VISIT_TOKEN_PATTERN.test(input.visitToken)) {
    return invalidInput("visitToken không hợp lệ");
  }

  const goalsSnapshot = parseSelections(input.goals, "goals", ALLOWED_GOALS);
  const dietaryPreferencesSnapshot = parseSelections(
    input.dietaryPreferences,
    "dietaryPreferences",
    ALLOWED_PREFERENCES
  );
  const tableSession = await deps.findTableSession(tableSessionId);

  if (!tableSession || tableSession.restaurantId.toString() !== restaurantId.toString()) {
    throw new AnonymousDiningVisitServiceError(
      404,
      "TABLE_SESSION_NOT_FOUND",
      "Không tìm thấy phiên bàn phù hợp"
    );
  }
  if (![TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_REQUESTED].includes(tableSession.status)) {
    throw new AnonymousDiningVisitServiceError(
      409,
      "TABLE_SESSION_INACTIVE",
      "Phiên bàn không còn hoạt động"
    );
  }

  return deps.upsertVisit({
    restaurantId,
    tableSessionId,
    visitToken: input.visitToken,
    goalsSnapshot,
    dietaryPreferencesSnapshot
  });
}
