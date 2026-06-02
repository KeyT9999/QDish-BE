import { ComputedNutrition } from "../../services/nutritionService.js";

export interface DiningContext {
  timeOfDay?: "breakfast" | "lunch" | "dinner" | "late_night";
  postWorkout?: boolean;
  weather?: "hot" | "rainy" | "cool" | "cold";
  occasion?: string;
}

export interface UserDiningProfile {
  goals: string[];
  allergies: string[];
  preferences: string[];
}

export interface FitScoreResult {
  score: number;
  confidence: number;
  blocked: boolean;
  blockReason?: string;
}

export type FitScoreMap = Record<string, number>;

export class FitScoreEngine {
  public static SCORE_LABELS: Record<string, string> = {
    gym_fit: "Gym Fit",
    keto_fit: "Keto Fit",
    office_lunch_fit: "Office Lunch Fit",
    late_night_fit: "Late Night Fit",
    energy_boost_fit: "Energy Boost Fit",
    post_workout_fit: "Post Workout Fit",
    family_sharing_fit: "Family Sharing Fit",
    quick_lunch_fit: "Quick Lunch Fit",
    date_night_fit: "Date Night Fit",
  };

  /**
   * Calculates a base score (0-100) based strictly on nutrition metrics and matched attributes.
   */
  public static calculateBaseScore(n: ComputedNutrition, attributes: string[], scoreType: string): number {
    switch (scoreType) {
      case "gym_fit": {
        const proteinDensity = Math.min(100, (n.protein / (n.calories || 1)) * 4 * 100 * 2);
        const carbQuality = attributes.includes("LOW_SUGAR") ? 100 : 60;
        const fatLevel = attributes.includes("LOW_FAT") ? 100 : n.fat <= 20 ? 80 : 40;
        const calorieAdequacy = n.calories >= 400 && n.calories <= 750 ? 100 : 70;
        const fiberContent = Math.min(100, (n.fiber / 6) * 100);

        return (
          proteinDensity * 0.4 +
          carbQuality * 0.2 +
          fatLevel * 0.15 +
          calorieAdequacy * 0.15 +
          fiberContent * 0.1
        );
      }

      case "keto_fit": {
        const totalKcal = n.protein * 4 + n.carb * 4 + n.fat * 9;
        const fatKcalRatio = totalKcal > 0 ? (n.fat * 9) / totalKcal : 0;
        const fatRatio = Math.min(100, (fatKcalRatio / 0.6) * 100);
        const carbRestriction = n.carb <= 20 ? 100 : Math.max(0, 100 - (n.carb - 20) * 5);
        const proteinModeration = n.protein >= 15 && n.protein <= 35 ? 100 : 70;

        return fatRatio * 0.5 + carbRestriction * 0.35 + proteinModeration * 0.15;
      }

      case "office_lunch_fit": {
        const calorieRange = n.calories >= 400 && n.calories <= 700 ? 100 : n.calories < 400 ? 80 : 50;
        const convenience = attributes.includes("QUICK_BITE") ? 100 : 75;
        const satiety = Math.min(100, ((n.protein + n.fiber) / 15) * 100);
        const notMessy = attributes.includes("LIGHT_MEAL") ? 100 : 85;

        return calorieRange * 0.3 + convenience * 0.25 + satiety * 0.25 + notMessy * 0.2;
      }

      case "late_night_fit": {
        const comfortFood = attributes.includes("COMFORT_FOOD") || attributes.includes("LATE_NIGHT_FIT") ? 100 : 60;
        const moderateCalories = n.calories <= 600 ? 100 : Math.max(0, 100 - (n.calories - 600) * 0.2);
        const satiety = n.calories >= 300 ? 100 : 60;
        const digestibility = n.fat <= 15 ? 100 : 50;

        return comfortFood * 0.35 + moderateCalories * 0.3 + satiety * 0.2 + digestibility * 0.15;
      }

      case "energy_boost_fit": {
        const complexCarbs = attributes.includes("HIGH_CARB") ? 100 : Math.min(100, (n.carb / 50) * 100);
        const quickEnergy = n.calories >= 500 ? 100 : 70;
        const stimulants = 80;
        const timing = 90;

        return complexCarbs * 0.35 + quickEnergy * 0.3 + stimulants * 0.2 + timing * 0.15;
      }

      case "post_workout_fit": {
        const proteinDensity = Math.min(100, (n.protein / 25) * 100);
        const carbRecovery = n.carb >= 30 && n.carb <= 60 ? 100 : 60;
        const timingFit = 90;
        const inflammation = 80;

        return proteinDensity * 0.4 + carbRecovery * 0.3 + timingFit * 0.2 + inflammation * 0.1;
      }

      case "family_sharing_fit": {
        const portionSize = attributes.includes("SOCIAL_SHARING") || attributes.includes("FAMILY_MEAL") ? 100 : 40;
        const variety = attributes.includes("VEGETARIAN") || attributes.includes("VEGAN") ? 100 : 80;
        const crowdPleasing = 85;

        return portionSize * 0.4 + variety * 0.3 + crowdPleasing * 0.3;
      }

      case "quick_lunch_fit": {
        const speed = attributes.includes("QUICK_BITE") ? 100 : 70;
        const calories = n.calories <= 500 ? 100 : 60;
        const satiety = Math.min(100, (n.protein / 15) * 100);
        const portability = 85;

        return speed * 0.3 + calories * 0.3 + satiety * 0.25 + portability * 0.15;
      }

      case "date_night_fit": {
        const experience = attributes.includes("COMFORT_FOOD") ? 100 : 75;
        const shareable = attributes.includes("SOCIAL_SHARING") ? 100 : 60;
        const flavorComplexity = 85;
        const presentation = 90;

        return experience * 0.35 + shareable * 0.3 + flavorComplexity * 0.2 + presentation * 0.15;
      }

      default:
        return 50;
    }
  }

  /**
   * Applies time-based and environmental modifiers to the fit score.
   */
  public static getContextMultiplier(scoreType: string, context?: DiningContext): number {
    if (!context) return 1.0;

    let multiplier = 1.0;
    if (scoreType === "gym_fit" || scoreType === "post_workout_fit") {
      if (context.postWorkout) {
        multiplier *= 1.3;
      }
      if (context.timeOfDay === "late_night") {
        multiplier *= 0.8;
      }
    }
    if (scoreType === "late_night_fit") {
      if (context.timeOfDay === "late_night") {
        multiplier *= 1.2;
      }
      if (context.weather === "rainy") {
        multiplier *= 1.1;
      }
    }
    if (scoreType === "office_lunch_fit" || scoreType === "quick_lunch_fit") {
      if (context.timeOfDay === "lunch") {
        multiplier *= 1.2;
      }
    }
    return multiplier;
  }

  /**
   * Applies user goals/preference modifiers.
   */
  public static getUserPreferenceMultiplier(
    scoreType: string,
    userProfile?: UserDiningProfile
  ): number {
    if (!userProfile) return 1.0;

    let multiplier = 1.0;

    // Map user profile goals to score types
    if (scoreType === "gym_fit" && userProfile.goals.includes("MUSCLE_GAIN")) {
      multiplier *= 1.2;
    }
    if (scoreType === "office_lunch_fit" && userProfile.goals.includes("BALANCED")) {
      multiplier *= 1.15;
    }
    if (scoreType === "late_night_fit" && userProfile.goals.includes("COMFORT")) {
      multiplier *= 1.2;
    }

    return multiplier;
  }

  /**
   * Evaluates if any ingredients or allergens conflict with user allergies.
   */
  public static hasAllergenConflict(allergens: string[], userProfile?: UserDiningProfile): boolean {
    if (!userProfile || !userProfile.allergies || userProfile.allergies.length === 0) {
      return false;
    }
    // Check intersection
    return allergens.some((a) => userProfile.allergies.map(x => x.toLowerCase()).includes(a.toLowerCase()));
  }

  /**
   * Computes a full FitScoreResult for a single score type.
   */
  public static calculateFitScore(
    n: ComputedNutrition,
    attributes: string[],
    scoreType: string,
    userProfile?: UserDiningProfile,
    context?: DiningContext
  ): FitScoreResult {
    // 1. Check allergens first (hard block)
    if (this.hasAllergenConflict(n.allergens, userProfile)) {
      return {
        score: 0,
        confidence: 1.0,
        blocked: true,
        blockReason: "allergen"
      };
    }

    // 2. Base score calculation
    const baseScore = this.calculateBaseScore(n, attributes, scoreType);

    // 3. Modifiers
    const contextMult = this.getContextMultiplier(scoreType, context);
    const prefMult = this.getUserPreferenceMultiplier(scoreType, userProfile);

    // 4. Composite final score capped at 100
    const finalScore = Math.min(100, Math.round(baseScore * contextMult * prefMult));

    return {
      score: finalScore,
      confidence: n.nutritionConfidence,
      blocked: false
    };
  }

  /**
   * Computes base scores for all 9 dining contexts.
   */
  public static calculateAllFitScores(
    n: ComputedNutrition,
    attributes: string[],
    userProfile?: UserDiningProfile,
    context?: DiningContext
  ): FitScoreMap {
    const scores: FitScoreMap = {};
    for (const key of Object.keys(this.SCORE_LABELS)) {
      const result = this.calculateFitScore(n, attributes, key, userProfile, context);
      scores[key] = result.score;
    }
    return scores;
  }

  /**
   * Gets the highest scoring fit context.
   */
  public static getBestFitContext(fitScores: FitScoreMap): { type: string; score: number; label: string } {
    const entries = Object.entries(fitScores);
    if (entries.length === 0) {
      return { type: "general", score: 50, label: "General Fit" };
    }
    const best = entries.reduce((a, b) => (a[1] > b[1] ? a : b));
    return {
      type: best[0],
      score: best[1],
      label: this.SCORE_LABELS[best[0]] || "General Fit",
    };
  }
}
