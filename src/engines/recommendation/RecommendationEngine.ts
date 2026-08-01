import mongoose from "mongoose";
import { MenuItem, IMenuItem } from "../../models/MenuItem.js";
import { DishNutritionProfile, IDishNutritionProfile } from "../../models/DishNutritionProfile.js";
import type {
  DiningProfileSnapshot,
  RecommendationContextInput,
} from "../../services/diningProfileValidation.js";
import { FitScoreEngine } from "../fitScore/FitScoreEngine.js";

export type RecommendationMode = "GENERAL" | "PERSONALIZED";
export type RecommendationEmptyReason = "NO_AVAILABLE_DISHES" | "NO_ALLERGEN_SAFE_DISHES";

export interface RecommendationEngineDependencies {
  findMenuItems(restaurantId: mongoose.Types.ObjectId): Promise<IMenuItem[]>;
  findNutritionProfiles(dishIds: unknown[]): Promise<IDishNutritionProfile[]>;
}

export interface RecommendedDish {
  dish: IMenuItem;
  fitScore: number;
  bestContext: string;
  bestContextLabel: string;
  reason: string;
  allergenWarnings: string[];
}

export interface ScoredDish {
  dish: IMenuItem;
  fitScore: number;
  bestContext: string;
  bestContextLabel: string;
  allergenWarnings: string[];
}

export interface PairingSuggestion {
  mainDishId: string;
  mainDishName: string;
  pairedDish: IMenuItem;
  reason: string;
}

export interface RecommendationResponse {
  mode: RecommendationMode;
  emptyReason?: RecommendationEmptyReason;
  bestForYou: RecommendedDish[];
  fullMenu: ScoredDish[];
  pairingSuggestions: PairingSuggestion[];
}

const defaultDependencies: RecommendationEngineDependencies = {
  async findMenuItems(restaurantId) {
    return (await MenuItem.find({ restaurantId, available: true }).lean()) as unknown as IMenuItem[];
  },
  async findNutritionProfiles(dishIds) {
    return (await DishNutritionProfile.find({
      dishId: { $in: dishIds },
    }).lean()) as unknown as IDishNutritionProfile[];
  },
};

function emptyResponse(mode: RecommendationMode, emptyReason: RecommendationEmptyReason): RecommendationResponse {
  return {
    mode,
    emptyReason,
    bestForYou: [],
    fullMenu: [],
    pairingSuggestions: [],
  };
}

function normalizedAllergens(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.toLowerCase());
}

function hasAllergenConflict(allergens: string[], userProfile?: DiningProfileSnapshot): boolean {
  const requestedAllergies = new Set(normalizedAllergens(userProfile?.allergies));
  return allergens.some((allergen) => requestedAllergies.has(allergen.toLowerCase()));
}

function generalReason(dish: IMenuItem, primaryScore: number, context?: RecommendationContextInput): string {
  const timeDescription = context?.timeOfDay ? ` cho bữa ${context.timeOfDay}` : "";
  return `${dish.name} đạt ${primaryScore}% điểm phù hợp${timeDescription}.`;
}

function personalizedReason(
  primaryScore: number,
  bestContext: string,
  protein: number,
): string {
  if (primaryScore >= 80 && bestContext === "gym_fit") {
    return `✨ Đạt ${primaryScore}% Gym Fit nhờ cung cấp ${protein}g đạm, hỗ trợ phục hồi cơ bắp.`;
  }
  if (primaryScore >= 80 && bestContext === "energy_boost_fit") {
    return `⚡ Đạt ${primaryScore}% cho mục tiêu tăng năng lượng nhờ nguồn tinh bột bền bỉ.`;
  }
  if (primaryScore >= 80 && bestContext === "late_night_fit") {
    return `🌙 Đạt ${primaryScore}% cho bữa muộn dễ chịu và vừa bụng.`;
  }
  return `Phù hợp ${primaryScore}% với khẩu vị của bạn.`;
}

function isPairingCandidate(dish: IMenuItem): boolean {
  const category = dish.category.toLowerCase();
  return (
    category.includes("salad")
    || category.includes("uống")
    || category.includes("rau")
    || dish.foodAttributes?.includes("LIGHT_MEAL") === true
    || dish.foodAttributes?.includes("REFRESHING") === true
  );
}

export class RecommendationEngine {
  /**
   * Generates general or personalized dish recommendations and allergen-safe pairing suggestions.
   */
  public static async generateRecommendations(
    restaurantId: string,
    userProfile?: DiningProfileSnapshot,
    context?: RecommendationContextInput,
    dependencies: RecommendationEngineDependencies = defaultDependencies,
  ): Promise<RecommendationResponse> {
    const rId = new mongoose.Types.ObjectId(restaurantId);
    const mode: RecommendationMode = userProfile
      && (userProfile.goals.length > 0 || userProfile.preferences.length > 0)
      ? "PERSONALIZED"
      : "GENERAL";

    const menuItems = await dependencies.findMenuItems(rId);
    if (menuItems.length === 0) {
      return emptyResponse(mode, "NO_AVAILABLE_DISHES");
    }

    const nutritionProfiles = await dependencies.findNutritionProfiles(menuItems.map((item) => item._id));
    const profileMap = new Map<string, IDishNutritionProfile>();
    for (const profile of nutritionProfiles) {
      profileMap.set(profile.dishId.toString(), profile);
    }

    const safeMenuItems = menuItems.filter((dish) => {
      const cachedProfile = profileMap.get(dish._id.toString());
      const combinedAllergens = [
        ...normalizedAllergens(dish.allergens),
        ...normalizedAllergens(cachedProfile?.allergens),
      ];
      return !hasAllergenConflict(combinedAllergens, userProfile);
    });

    if (safeMenuItems.length === 0) {
      return emptyResponse(mode, "NO_ALLERGEN_SAFE_DISHES");
    }

    const resolvedType = FitScoreEngine.resolvePrimaryScoreType(userProfile);
    const scoredItems: RecommendedDish[] = [];
    const fullMenu: ScoredDish[] = [];

    for (const dish of safeMenuItems) {
      const cachedProfile = profileMap.get(dish._id.toString());
      const allergens = [
        ...normalizedAllergens(dish.allergens),
        ...normalizedAllergens(cachedProfile?.allergens),
      ];
      const foodAttributes = dish.foodAttributes ?? [];
      const computedNutrition = {
        calories: cachedProfile?.calories ?? dish.calories ?? 0,
        protein: cachedProfile?.protein ?? dish.protein ?? 0,
        carb: cachedProfile?.carb ?? dish.carbs ?? 0,
        fat: cachedProfile?.fat ?? dish.fat ?? 0,
        fiber: cachedProfile?.fiber ?? dish.fiber ?? 0,
        sugar: cachedProfile?.sugar ?? dish.sugar ?? 0,
        sodium: cachedProfile?.sodium ?? dish.sodium ?? 0,
        attributes: foodAttributes,
        allergens,
        nutritionConfidence: cachedProfile?.nutritionConfidence ?? 1,
      };
      const fitScores = FitScoreEngine.calculateAllFitScores(
        computedNutrition,
        foodAttributes,
        userProfile,
        context,
      );
      const bestFit = FitScoreEngine.getBestFitContext(fitScores);
      const primaryScore = resolvedType ? (fitScores[resolvedType] ?? bestFit.score) : bestFit.score;
      const allergenWarnings: string[] = [];
      const reason = mode === "PERSONALIZED"
        ? personalizedReason(primaryScore, bestFit.type, computedNutrition.protein)
        : generalReason(dish, primaryScore, context);

      scoredItems.push({
        dish,
        fitScore: primaryScore,
        bestContext: bestFit.type,
        bestContextLabel: bestFit.label,
        reason,
        allergenWarnings,
      });
      fullMenu.push({
        dish,
        fitScore: primaryScore,
        bestContext: bestFit.type,
        bestContextLabel: bestFit.label,
        allergenWarnings,
      });
    }

    const bestForYou = scoredItems
      .filter((item) => item.fitScore > 0)
      .sort((a, b) => b.fitScore - a.fitScore)
      .slice(0, 3);
    const sideDishes = safeMenuItems.filter(isPairingCandidate);
    const pairingSuggestions: PairingSuggestion[] = [];

    for (const recommendation of bestForYou) {
      const pairedDish = sideDishes.find((dish) => dish._id.toString() !== recommendation.dish._id.toString());
      if (!pairedDish) continue;

      pairingSuggestions.push({
        mainDishId: recommendation.dish._id.toString(),
        mainDishName: recommendation.dish.name,
        pairedDish,
        reason: recommendation.dish.foodAttributes?.includes("HIGH_PROTEIN")
          ? `Ăn kèm với ${pairedDish.name} để bổ sung chất xơ và cân bằng bữa ăn.`
          : "Sự kết hợp giúp cân bằng hương vị cho bữa ăn.",
      });
    }

    return {
      mode,
      bestForYou,
      fullMenu: fullMenu.sort((a, b) => b.fitScore - a.fitScore),
      pairingSuggestions,
    };
  }
}
