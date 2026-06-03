import { DishNutritionProfile } from "../models/DishNutritionProfile.js";

type IndexKey = Record<string, unknown>;

type CollectionIndex = {
  name?: string;
  key?: IndexKey;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
};

type WriteResult = {
  matchedCount?: number;
  modifiedCount?: number;
  deletedCount?: number;
};

type NutritionProfileCollection = {
  indexes(): Promise<CollectionIndex[]>;
  updateMany(filter: unknown, update: unknown): Promise<WriteResult>;
  deleteMany(filter: unknown): Promise<WriteResult>;
  dropIndex(name: string): Promise<unknown>;
  createIndex(key: IndexKey, options: Record<string, unknown>): Promise<string>;
};

export type DishNutritionProfileIndexRepairResult = {
  migratedLegacyProfiles: number;
  deletedInvalidProfiles: number;
  removedLegacyDishIdField: number;
  droppedLegacyDishIdIndex: boolean;
  rebuiltDishIdIndex: boolean;
  ensuredDishIdIndex: boolean;
};

const EXPECTED_DISH_ID_PARTIAL_FILTER = { dishId: { $type: "objectId" } };

const isSameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const isNamespaceNotFoundError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  ("code" in error ? (error as { code?: number }).code === 26 : false);

const getModifiedCount = (result: WriteResult) => result.modifiedCount ?? result.matchedCount ?? 0;

const isLegacyDishIdIndex = (index: CollectionIndex) =>
  index.name === "dish_id_1" || isSameJson(index.key, { dish_id: 1 });

const isDishIdIndex = (index: CollectionIndex) =>
  index.name === "dishId_1" || isSameJson(index.key, { dishId: 1 });

const isExpectedDishIdIndex = (index: CollectionIndex) =>
  isDishIdIndex(index) &&
  index.unique === true &&
  isSameJson(index.partialFilterExpression, EXPECTED_DISH_ID_PARTIAL_FILTER);

export async function repairDishNutritionProfileIndexes(
  collection: NutritionProfileCollection = DishNutritionProfile.collection as unknown as NutritionProfileCollection
): Promise<DishNutritionProfileIndexRepairResult> {
  let indexes: CollectionIndex[] = [];

  try {
    indexes = await collection.indexes();
  } catch (error) {
    if (!isNamespaceNotFoundError(error)) {
      throw error;
    }
  }

  const migrateResult = await collection.updateMany(
    { dishId: { $exists: false }, dish_id: { $exists: true, $ne: null } },
    [{ $set: { dishId: "$dish_id" } }]
  );

  const deleteInvalidResult = await collection.deleteMany({
    $or: [{ dishId: null }, { dishId: { $exists: false } }]
  });

  let droppedLegacyDishIdIndex = false;
  for (const index of indexes.filter(isLegacyDishIdIndex)) {
    if (index.name) {
      await collection.dropIndex(index.name);
      droppedLegacyDishIdIndex = true;
    }
  }

  let rebuiltDishIdIndex = false;
  for (const index of indexes.filter((candidate) => isDishIdIndex(candidate) && !isExpectedDishIdIndex(candidate))) {
    if (index.name) {
      await collection.dropIndex(index.name);
      rebuiltDishIdIndex = true;
    }
  }

  const removeLegacyFieldResult = await collection.updateMany(
    { dish_id: { $exists: true } },
    { $unset: { dish_id: "" } }
  );

  await collection.createIndex(
    { dishId: 1 },
    {
      name: "dishId_1",
      unique: true,
      partialFilterExpression: EXPECTED_DISH_ID_PARTIAL_FILTER
    }
  );

  return {
    migratedLegacyProfiles: getModifiedCount(migrateResult),
    deletedInvalidProfiles: deleteInvalidResult.deletedCount ?? 0,
    removedLegacyDishIdField: getModifiedCount(removeLegacyFieldResult),
    droppedLegacyDishIdIndex,
    rebuiltDishIdIndex,
    ensuredDishIdIndex: true
  };
}
