import mongoose from "mongoose";
import { FitScoreEngine, DiningContext, UserDiningProfile } from "../engines/fitScore/FitScoreEngine.js";
import { MenuItem } from "../models/MenuItem.js";
import { DishNutritionProfile } from "../models/DishNutritionProfile.js";
import { ComputedNutrition } from "./nutritionService.js";

export interface BatchFitScoreInput {
  restaurantId: string;
  userProfile: UserDiningProfile;
  context?: DiningContext;
}

export interface FitScoreSummary {
  score: number;
  label: string;
  contextType: string;
  reasons: string[];
  blocked: boolean;
  blockReason?: "allergen";
}

export type FitScoreMapResponse = Record<string, FitScoreSummary>;

export interface BatchMenuItem {
  _id: mongoose.Types.ObjectId;
  restaurantId: mongoose.Types.ObjectId;
  available: boolean;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  allergens?: string[];
  foodAttributes?: string[];
}

export interface BatchNutritionProfile {
  dishId: mongoose.Types.ObjectId;
  restaurantId: mongoose.Types.ObjectId;
  calories: number;
  protein: number;
  carb: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
  attributes: string[];
  allergens: string[];
  nutritionConfidence: number;
}

export interface MenuItemQuery {
  restaurantId: mongoose.Types.ObjectId;
  available: true;
}

export interface NutritionProfileQuery {
  dishId: { $in: mongoose.Types.ObjectId[] };
  restaurantId: mongoose.Types.ObjectId;
}

export interface BatchFitScoreDependencies {
  findMenuItems(query: MenuItemQuery): Promise<BatchMenuItem[]>;
  findNutritionProfiles(query: NutritionProfileQuery): Promise<BatchNutritionProfile[]>;
}

const defaultDependencies: BatchFitScoreDependencies = {
  async findMenuItems(query) {
    const menuItems = await MenuItem.find(query).lean();
    return menuItems as unknown as BatchMenuItem[];
  },
  async findNutritionProfiles(query) {
    const profiles = await DishNutritionProfile.find(query).lean();
    return profiles as unknown as BatchNutritionProfile[];
  },
};

function labelForScore(score: number): string {
  if (score >= 80) return "Rất phù hợp";
  if (score >= 60) return "Phù hợp";
  return "Có thể cân nhắc";
}

function unionCaseInsensitive(...values: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const union: string[] = [];

  for (const value of values) {
    for (const item of value ?? []) {
      const key = item.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        union.push(item);
      }
    }
  }

  return union;
}

function nutritionFor(
  dish: BatchMenuItem,
  profile?: BatchNutritionProfile
): ComputedNutrition {
  const attributes = profile?.attributes ?? dish.foodAttributes ?? [];

  return {
    calories: profile?.calories ?? dish.calories ?? 0,
    protein: profile?.protein ?? dish.protein ?? 0,
    carb: profile?.carb ?? dish.carbs ?? 0,
    fat: profile?.fat ?? dish.fat ?? 0,
    fiber: profile?.fiber ?? dish.fiber ?? 0,
    sugar: profile?.sugar ?? dish.sugar ?? 0,
    sodium: profile?.sodium ?? dish.sodium ?? 0,
    attributes,
    allergens: unionCaseInsensitive(profile?.allergens, dish.allergens),
    nutritionConfidence: profile?.nutritionConfidence ?? 1,
  };
}

function buildReasons(
  contextType: string,
  nutrition: ComputedNutrition,
  attributes: string[],
  userProfile: UserDiningProfile,
  context?: DiningContext
): string[] {
  const reasons: string[] = [];
  const matchingGoal = userProfile.goals.find(
    (goal) => FitScoreEngine.resolvePrimaryScoreType({ ...userProfile, goals: [goal] }) === contextType
  );
  if (matchingGoal) {
    reasons.push(`Hỗ trợ mục tiêu ${matchingGoal}`);
  }

  const preferences = new Set(userProfile.preferences.map((preference) => preference.toLowerCase()));
  const matchingAttribute = attributes.find((attribute) => preferences.has(attribute.toLowerCase()));
  if (matchingAttribute) {
    reasons.push(`Phù hợp sở thích ${matchingAttribute}`);
  }

  if (nutrition.protein >= 20) {
    reasons.push(`Giàu đạm (${nutrition.protein}g)`);
  } else if (nutrition.fiber >= 5) {
    reasons.push(`Giàu chất xơ (${nutrition.fiber}g)`);
  } else if (nutrition.calories > 0) {
    reasons.push(`Cung cấp ${nutrition.calories} kcal`);
  }

  if (context?.postWorkout) {
    reasons.push("Phù hợp sau tập");
  } else if (context?.timeOfDay === "breakfast") {
    reasons.push("Phù hợp bữa sáng");
  } else if (context?.timeOfDay === "lunch") {
    reasons.push("Phù hợp bữa trưa");
  } else if (context?.timeOfDay === "dinner") {
    reasons.push("Phù hợp bữa tối");
  } else if (context?.timeOfDay === "late_night") {
    reasons.push("Phù hợp bữa khuya");
  }

  return reasons.slice(0, 3);
}

export async function calculateBatchFitScores(
  input: BatchFitScoreInput,
  dependencies: BatchFitScoreDependencies = defaultDependencies
): Promise<FitScoreMapResponse> {
  const restaurantObjectId = new mongoose.Types.ObjectId(input.restaurantId);
  const dishes = await dependencies.findMenuItems({
    restaurantId: restaurantObjectId,
    available: true,
  });
  const profiles = await dependencies.findNutritionProfiles({
    dishId: { $in: dishes.map((dish) => dish._id) },
    restaurantId: restaurantObjectId,
  });

  const profilesByDishId = new Map(
    profiles.map((profile) => [profile.dishId.toString(), profile])
  );
  const requestedType = FitScoreEngine.resolvePrimaryScoreType(input.userProfile);
  const response: FitScoreMapResponse = {};

  for (const dish of dishes) {
    const nutrition = nutritionFor(dish, profilesByDishId.get(dish._id.toString()));
    const attributes = nutrition.attributes;
    const fitScores = FitScoreEngine.calculateAllFitScores(
      nutrition,
      attributes,
      input.userProfile,
      input.context
    );

    if (FitScoreEngine.hasAllergenConflict(nutrition.allergens, input.userProfile)) {
      response[dish._id.toString()] = {
        score: 0,
        label: "Có dị ứng",
        contextType: "allergen_block",
        reasons: ["Món có thành phần xung đột với dị ứng đã chọn"],
        blocked: true,
        blockReason: "allergen",
      };
      continue;
    }

    const best = FitScoreEngine.getBestFitContext(fitScores);
    const contextType = requestedType ?? best.type;
    const score = fitScores[contextType] ?? best.score;

    response[dish._id.toString()] = {
      score,
      label: labelForScore(score),
      contextType,
      reasons: buildReasons(contextType, nutrition, attributes, input.userProfile, input.context),
      blocked: false,
    };
  }

  return response;
}
