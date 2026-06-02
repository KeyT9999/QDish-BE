import { ComputedNutrition } from "../../services/nutritionService.js";

export interface DishContext {
  servingCount: number;
  ingredients: Array<{
    ingredientId: string;
    name: string;
    category: string;
    allergens: string[];
  }>;
}

export interface AttributeRule {
  key: string;
  evaluate: (nutrition: ComputedNutrition, context: DishContext) => boolean;
}

/**
 * Checks if a specific ingredient is vegetarian-friendly.
 */
export function isVegetarianIngredient(name: string, category: string, allergens: string[]): boolean {
  const normalized = name.toLowerCase().trim();

  // Allergen checks
  if (allergens.includes("fish") || allergens.includes("shellfish")) {
    return false;
  }

  // Specific list of animal protein keywords
  const meatKeywords = [
    "ức gà", "gà", "bò", "heo", "lợn", "tôm", "cá", "hải sản", "mực", "sò", "nghêu", "ốc", "mắm", "lươn", "cua", "nhím", "dê", "cừu", "vịt", "chim",
    "chicken", "beef", "pork", "fish", "shrimp", "seafood", "prawn", "squid", "crab", "meat", "bacon", "ham", "sausage", "lamb", "mutton", "duck"
  ];

  // Specific plant-based items or ingredients containing substrings like "cá" or "bò" that are actually vegetables
  const actualExceptions = ["cà chua", "cà rốt", "cà tím", "cà pháo", "hạt điều", "peanuts", "bơ thực vật", "bơ đậu", "đậu hũ", "tofu"];
  if (actualExceptions.some((ex) => normalized.includes(ex))) {
    return true;
  }

  // Check if it belongs to 'protein' and isn't a plant protein
  if (category === "protein") {
    const isPlantProtein =
      normalized.includes("đậu hũ") ||
      normalized.includes("tofu") ||
      normalized.includes("đậu phụ") ||
      normalized.includes("chay") ||
      normalized.includes("tempeh") ||
      normalized.includes("seitan");
    if (!isPlantProtein) {
      return false;
    }
  }

  // General keyword check with word boundary logic for "cá"
  for (const keyword of meatKeywords) {
    if (keyword === "cá" || keyword === "ca") {
      const words = normalized.split(/\s+|-/);
      const hasCa = words.some((w) => w === "cá" || w === "ca");
      if (hasCa && !actualExceptions.some((ex) => normalized.includes(ex))) {
        return false;
      }
    } else {
      if (normalized.includes(keyword)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Checks if a specific ingredient is vegan-friendly.
 */
export function isVeganIngredient(name: string, category: string, allergens: string[]): boolean {
  if (!isVegetarianIngredient(name, category, allergens)) {
    return false;
  }

  const normalized = name.toLowerCase().trim();

  // Allergen checks
  if (allergens.includes("eggs") || allergens.includes("dairy")) {
    return false;
  }

  // Vegan restrictions (eggs, dairy, honey, etc.)
  const animalProductKeywords = [
    "trứng", "bơ lạt", "bơ", "sữa tươi", "sữa", "phô mai", "pho mai",
    "egg", "butter", "milk", "cheese", "honey", "cream", "yogurt"
  ];

  // Exceptions for plant-based milks/butters
  const veganExceptions = [
    "sữa đậu", "sữa hạt", "bơ thực vật", "bơ đậu", "bơ hạt",
    "coconut milk", "soy milk", "almond milk", "peanut butter"
  ];
  if (veganExceptions.some((ex) => normalized.includes(ex))) {
    return true;
  }

  for (const keyword of animalProductKeywords) {
    if (normalized.includes(keyword)) {
      return false;
    }
  }

  return true;
}

// ─── 23 Attribute Rules ──────────────────────────────────────────────────────

export const attributeRules: AttributeRule[] = [
  {
    key: "HIGH_PROTEIN",
    evaluate: (n) => n.protein >= 25
  },
  {
    key: "VERY_HIGH_PROTEIN",
    evaluate: (n) => n.protein >= 40
  },
  {
    key: "ENERGY_DENSE",
    evaluate: (n) => n.calories >= 600
  },
  {
    key: "HEAVY_MEAL",
    evaluate: (n) => n.calories >= 700 || n.fat >= 25
  },
  {
    key: "LIGHT_MEAL",
    evaluate: (n) => n.calories <= 400 && n.fat <= 15
  },
  {
    key: "LOW_SUGAR",
    evaluate: (n) => n.sugar <= 5
  },
  {
    key: "LOW_CALORIE",
    evaluate: (n) => n.calories <= 400 && n.calories > 0
  },
  {
    key: "HIGH_FIBER",
    evaluate: (n) => n.fiber >= 6
  },
  {
    key: "LOW_FAT",
    evaluate: (n) => n.fat <= 10 && n.calories > 0
  },
  {
    key: "HIGH_CARB",
    evaluate: (n) => n.carb >= 80
  },
  {
    key: "KETO_FRIENDLY",
    evaluate: (n) => {
      const totalKcal = n.protein * 4 + n.carb * 4 + n.fat * 9;
      if (totalKcal === 0) return false;
      const fatKcalPercentage = (n.fat * 9) / totalKcal;
      return n.carb <= 20 && fatKcalPercentage >= 0.60;
    }
  },
  {
    key: "POST_WORKOUT",
    evaluate: (n) => n.protein >= 25 && n.carb >= 30 && n.carb <= 60
  },
  {
    key: "SOCIAL_SHARING",
    evaluate: (_, ctx) => ctx.servingCount >= 2
  },
  {
    key: "VEGETARIAN",
    evaluate: (_, ctx) => {
      if (ctx.ingredients.length === 0) return false;
      return ctx.ingredients.every((ing) =>
        isVegetarianIngredient(ing.name, ing.category, ing.allergens)
      );
    }
  },
  {
    key: "VEGAN",
    evaluate: (_, ctx) => {
      if (ctx.ingredients.length === 0) return false;
      return ctx.ingredients.every((ing) =>
        isVeganIngredient(ing.name, ing.category, ing.allergens)
      );
    }
  },
  {
    key: "GLUTEN_FREE",
    evaluate: (_, ctx) => {
      if (ctx.ingredients.length === 0) return true;
      return ctx.ingredients.every((ing) => !ing.allergens.includes("gluten"));
    }
  },
  {
    key: "DAIRY_FREE",
    evaluate: (_, ctx) => {
      if (ctx.ingredients.length === 0) return true;
      return ctx.ingredients.every((ing) => !ing.allergens.includes("dairy"));
    }
  },
  {
    key: "OFFICE_LUNCH",
    evaluate: (n) => {
      const isHeavy = n.calories >= 700 || n.fat >= 25;
      return n.calories >= 400 && n.calories <= 700 && !isHeavy;
    }
  },
  {
    key: "QUICK_BITE",
    evaluate: (n, ctx) => n.calories <= 350 && ctx.servingCount === 1
  },
  {
    key: "FAMILY_MEAL",
    evaluate: (_, ctx) => ctx.servingCount >= 4
  },
  {
    key: "LATE_NIGHT_FIT",
    evaluate: (n) => {
      // Comfort profile but reasonable calories for late night
      const isComfort = n.fat >= 15 && n.carb >= 35;
      return isComfort && n.calories >= 300 && n.calories <= 600;
    }
  },
  {
    key: "COMFORT_FOOD",
    evaluate: (n) => n.fat >= 20 && n.carb >= 50
  },
  {
    key: "REFRESHING",
    evaluate: (n, ctx) => {
      const hasVeg = ctx.ingredients.some(
        (ing) => ing.category === "rau_cu" || ing.category === "vegetable"
      );
      return n.calories <= 300 && hasVeg;
    }
  }
];
