import { ComputedNutrition } from "../../services/nutritionService.js";
import { attributeRules, DishContext } from "./attributeRules.js";

export class AttributeEngine {
  /**
   * Evaluates all rules against ComputedNutrition and DishContext to return matching food attributes.
   */
  public static applyAllRules(nutrition: ComputedNutrition, context: DishContext): string[] {
    const matched: string[] = [];
    const hasCompleteNutrition = nutrition.isComplete === true && nutrition.completeness !== undefined && nutrition.completeness > 0;
    const hasCompleteComposition = hasCompleteNutrition
      && nutrition.missingIngredientCount === 0
      && context.ingredients.length > 0;

    for (const rule of attributeRules) {
      try {
        if (rule.requiresCompleteNutrition && !hasCompleteNutrition) {
          continue;
        }
        if (rule.requiresCompleteComposition && !hasCompleteComposition) {
          continue;
        }
        if (rule.evaluate(nutrition, context)) {
          matched.push(rule.key);
        }
      } catch (err) {
        console.error(`Error evaluating rule ${rule.key}:`, err);
      }
    }
    return matched;
  }
}
