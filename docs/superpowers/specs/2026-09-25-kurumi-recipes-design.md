# KURUMI demo recipe seed design

## Goal

Fill the 181 official KURUMI Da Nang menu entries already imported for the linked `Anvatcuti2` restaurant with plausible, one-serving ingredient recipes, so the Recipe Builder can be demonstrated to the teacher.

## Evidence and estimates

- Use KURUMI's current public Da Nang menu as the authority for menu names and stated ingredients. It identifies the restaurant as 100% plant-based and lists components for many dishes.
- Ingredient names found in menu descriptions are retained where they can be mapped unambiguously. For entries with no component list, infer a conventional plant-based composition from the dish name and menu category.
- Every recipe quantity, serving size, and cooking method is an estimate for a demo, not KURUMI's proprietary recipe. Set one serving per dish.
- Do not invent nutrition macros or allergen declarations. Recipe-scoped ingredients are local, `isVerified: false`, and have no nutrient facts; this keeps demo formulas separate from the global verified catalog and prevents claims that they are clinically or operationally accurate.

## Scope and safety

- Update recipe fields only (`ingredients`, `servingCount`, `servingSizeGrams`, `cookingMethod`) on the 181 official menu items of the exact restaurant linked to `Anvatcuti2`.
- Create/reuse only deterministic restaurant-scoped demo ingredients. No animal-derived ingredient may be assigned because the source states the menu is plant-based.
- Preserve menu listing fields, all five legacy menu records, restaurant/user/payment/subscription data, categories, and tables. No deletes.
- Use a guarded dry-run by default. Apply requires `--apply`, `--confirm-db QDish`, and the exact configured Atlas host; verify the username-to-restaurant link again before writing.
- Never recalculate or overwrite nutrition/allergen caches. Do not expose credentials or connection strings.

## Verification

- Unit tests cover all 181 recipes, representative source-backed ingredients, inferred recipes for missing-description drinks, positive quantities, gram resolution, supported cooking methods, vegan-only ingredient names, and recipe-only update patches.
- Dry-run reports recipe coverage, description-backed versus inferred counts, and ingredient create/reuse counts without writing.
- Apply verifies every target menu row has a non-empty recipe and that unrelated menu, account, payment, subscription, and table records remain unchanged.
- Run the workflow equivalents: `npm ci`, `npm run test:ci`, and `npm run build`; hosted GitHub CI is not claimed unless checked on the pushed commit.
