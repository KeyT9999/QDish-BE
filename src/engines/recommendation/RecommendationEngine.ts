import { MenuItem, IMenuItem } from "../../models/MenuItem.js";
import { DishNutritionProfile, IDishNutritionProfile } from "../../models/DishNutritionProfile.js";
import { FitScoreEngine, DiningContext, UserDiningProfile } from "../fitScore/FitScoreEngine.js";
import mongoose from "mongoose";

export interface RecommendedDish {
  dish: IMenuItem;
  fitScore: number;
  bestContext: string;
  bestContextLabel: string;
  reason: string;
  allergenWarnings: string[];
}

export interface PairingSuggestion {
  mainDishId: string;
  mainDishName: string;
  pairedDish: IMenuItem;
  reason: string;
}

export interface RecommendationResponse {
  bestForYou: RecommendedDish[];
  fullMenu: Array<{
    dish: IMenuItem;
    fitScore: number;
    bestContext: string;
    bestContextLabel: string;
    allergenWarnings: string[];
  }>;
  pairingSuggestions: PairingSuggestion[];
}

export class RecommendationEngine {
  /**
   * Generates highly personalized dish recommendations and pairing suggestions.
   */
  public static async generateRecommendations(
    restaurantId: string,
    userProfile?: UserDiningProfile,
    context?: DiningContext
  ): Promise<RecommendationResponse> {
    const rId = new mongoose.Types.ObjectId(restaurantId);

    // 1. Load all restaurant menu items
    const menuItems = await MenuItem.find({ restaurantId: rId, available: true }).lean();

    // 2. Load cached nutrition profiles
    const dishIds = menuItems.map((item) => item._id);
    const nutritionProfiles = await DishNutritionProfile.find({
      dishId: { $in: dishIds }
    }).lean();

    const profileMap = new Map<string, IDishNutritionProfile>();
    for (const p of nutritionProfiles) {
      profileMap.set(p.dishId.toString(), p as any);
    }

    const primaryGoalType =
      FitScoreEngine.resolvePrimaryScoreType(userProfile) ?? "office_lunch_fit";

    const scoredItems: RecommendedDish[] = [];
    const fullMenuItemsWithScores: any[] = [];

    for (const dish of menuItems) {
      const dishIdStr = dish._id.toString();
      const cachedProf = profileMap.get(dishIdStr);

      const allergens = dish.allergens || [];
      const foodAttributes = dish.foodAttributes || [];
      
      // Determine if there are allergen warning conflicts
      const allergenWarnings: string[] = [];
      if (userProfile && userProfile.allergies && userProfile.allergies.length > 0) {
        const intersection = allergens.filter((a) =>
          userProfile.allergies.map(x => x.toLowerCase()).includes(a.toLowerCase())
        );
        if (intersection.length > 0) {
          allergenWarnings.push(...intersection);
        }
      }

      // Convert cached profile or fallback to basic values for scoring
      const computedNutrition = {
        calories: cachedProf?.calories ?? dish.calories ?? 0,
        protein: cachedProf?.protein ?? dish.protein ?? 0,
        carb: cachedProf?.carb ?? dish.carbs ?? 0,
        fat: cachedProf?.fat ?? dish.fat ?? 0,
        fiber: cachedProf?.fiber ?? dish.fiber ?? 0,
        sugar: cachedProf?.sugar ?? dish.sugar ?? 0,
        sodium: cachedProf?.sodium ?? dish.sodium ?? 0,
        attributes: foodAttributes,
        allergens: allergens,
        nutritionConfidence: cachedProf?.nutritionConfidence ?? 1.0
      };

      // Calculate all fit scores
      const fitScores = FitScoreEngine.calculateAllFitScores(
        computedNutrition,
        foodAttributes,
        userProfile,
        context
      );

      const bestFit = FitScoreEngine.getBestFitContext(fitScores);
      const isBlocked = allergenWarnings.length > 0;

      // Primary score for sorting
      const primaryScore = isBlocked ? 0 : (fitScores[primaryGoalType] || bestFit.score);

      // Generate a dynamic, non-judgmental description of why it fits
      let reason = `Phù hợp ${primaryScore}% với khẩu vị của bạn.`;
      if (primaryScore >= 80) {
        if (primaryGoalType === "gym_fit") {
          reason = `✨ Đạt ${primaryScore}% Gym Fit nhờ cung cấp đạm dồi dào (${computedNutrition.protein}g) hỗ trợ phục hồi cơ bắp cực tốt.`;
        } else if (primaryGoalType === "energy_boost_fit") {
          reason = `⚡ Phù hợp ${primaryScore}% cho buổi sạc năng lượng nhờ lượng tinh bột phức hợp bền bỉ.`;
        } else if (primaryGoalType === "late_night_fit") {
          reason = `🌙 Món ngon dễ chịu đạt ${primaryScore}% cho bữa chiều muộn ấm bụng mà không đầy dạ dày.`;
        } else {
          reason = `🥗 Đạt chỉ số phù hợp cao (${primaryScore}%) cân đối hoàn hảo cho mục tiêu dinh dưỡng hôm nay.`;
        }
      }

      const recDish: RecommendedDish = {
        dish: dish as any,
        fitScore: primaryScore,
        bestContext: bestFit.type,
        bestContextLabel: bestFit.label,
        reason,
        allergenWarnings
      };

      scoredItems.push(recDish);
      fullMenuItemsWithScores.push({
        dish: dish as any,
        fitScore: primaryScore,
        bestContext: bestFit.type,
        bestContextLabel: bestFit.label,
        allergenWarnings
      });
    }

    // Sort to find the absolute best recommended items (excluding blocked ones)
    const bestForYou = scoredItems
      .filter((item) => item.fitScore > 0 && item.allergenWarnings.length === 0)
      .sort((a, b) => b.fitScore - a.fitScore)
      .slice(0, 3);

    // 6. Generate Pairing Suggestions
    const pairingSuggestions: PairingSuggestion[] = [];
    const sideDishes = menuItems.filter((d) => 
      d.category.toLowerCase().includes("salad") || 
      d.category.toLowerCase().includes("uống") || 
      d.category.toLowerCase().includes("rau") ||
      d.foodAttributes?.includes("LIGHT_MEAL") ||
      d.foodAttributes?.includes("REFRESHING")
    );

    for (const rec of bestForYou) {
      if (sideDishes.length > 0) {
        // Find a complementary side dish (not the main dish itself)
        const match = sideDishes.find((s) => s._id.toString() !== rec.dish._id.toString());
        if (match) {
          let pairingReason = "Sự kết hợp hoàn hảo giúp cân bằng hương vị.";
          if (rec.dish.foodAttributes?.includes("HIGH_PROTEIN")) {
            pairingReason = `🥗 Ăn kèm với ${match.name} để bổ sung thêm chất xơ tự nhiên và hỗ trợ hấp thụ đạm tối ưu.`;
          } else if (rec.dish.foodAttributes?.includes("HEAVY_MEAL")) {
            pairingReason = `🧊 Kết hợp ly nước thanh mát giúp bữa ăn nhẹ bớt ngấy và kích thích tiêu hóa dễ chịu hơn.`;
          }

          pairingSuggestions.push({
            mainDishId: rec.dish._id.toString(),
            mainDishName: rec.dish.name,
            pairedDish: match as any,
            reason: pairingReason
          });
        }
      }
    }

    return {
      bestForYou,
      fullMenu: fullMenuItemsWithScores.sort((a, b) => b.fitScore - a.fitScore),
      pairingSuggestions
    };
  }
}
