import { ComputedNutrition } from "../../services/nutritionService.js";
import { attributeRules, DishContext } from "./attributeRules.js";

export class AttributeEngine {
  /**
   * Evaluates all rules against ComputedNutrition and DishContext to return matching food attributes.
   */
  public static applyAllRules(nutrition: ComputedNutrition, context: DishContext): string[] {
    const matched: string[] = [];
    for (const rule of attributeRules) {
      try {
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
