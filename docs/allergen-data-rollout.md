# Allergen data rollout

This rollout applies to every restaurant tenant. Allergen declarations are tenant-owned, and the server checks restaurant ownership before accepting ingredient or menu reviews. The Kurumi demo seed is only sample candidate data; it does not mark those ingredients or dishes as confirmed.

## Data meaning

- `UNKNOWN` means the restaurant has not completed a supported review. An empty candidate list under `UNKNOWN` does not mean allergen-free.
- `REVIEWED` means an authorized restaurant user recorded a declaration with a supported source, a note, reviewer identity, and server timestamp. A reviewed empty list is an explicit declaration that the reviewer checked the supported allergen set and found no listed allergens.
- Ingredient and recipe-derived allergens are candidates. They can identify a known possible conflict while the dish remains `UNKNOWN`; they cannot establish that the complete recipe is safe.
- Dish declarations keep `contains` and `may contain` separate. Cross-contact warnings are not folded into the confirmed-ingredient list.
- Allergy profile state is captured with the order. Staff and bill views use that order snapshot. Public/shared-table serialization omits the customer's reported allergy profile and internal review evidence.

## Restaurant review workflow

1. Open the ingredient list and filter for unknown allergen information. Check each ingredient against supplier labeling, the restaurant recipe, or another available source. Enter supported allergen codes and evidence. Use an explicit reviewed-empty declaration only after checking the supported set.
2. Open the menu allergen review queue. Review each dish using the complete recipe where available. Recipe review is available only when every recipe ingredient resolves and has reviewed allergen data. If the restaurant does not maintain recipes in the system, use manual review and declare both `contains` and `may contain` from the restaurant's source.
3. Record a concise note identifying what was checked, for example supplier label and package/version, recipe revision, or the restaurant's cross-contact procedure. Do not use the menu description alone as proof of a complete declaration.
4. Save the review. The server records the authenticated reviewer and timestamp. Ingredient or recipe changes invalidate affected menu reviews, clear stale candidate cache as appropriate, and return those dishes to the review queue.
5. Revisit the queue after recipe or supplier changes. A failed recomputation leaves the dish unknown; resolve and retry it before declaring coverage complete.

## Customer experience

- A known candidate conflict is shown with the allergen name even if the dish is still unknown. The UI also says that the information is incomplete.
- Reviewed `contains` and `may contain` conflicts use distinct wording.
- Unknown dishes remain orderable. Warnings inform the customer's choice; they do not block adding the item or submitting an order.
- A menu-level summary reports conflicts and dishes still needing review. Cards use a compact status; details explain the evidence state and any known conflict.
- `NONE_DECLARED` and `NOT_ANSWERED` are distinct profile states. Not answering is never converted to “no allergies.”

## Audit and rollout sequence

1. Deploy the backend and frontend schema/API support before asking restaurants to review data. Old or incomplete declarations are treated as unknown.
2. Run the audit in its default read-only mode against the intended environment:

   ```powershell
   npm run audit:allergens
   ```

   The command prints ingredient and dish counts by restaurant, unknown/reviewed counts, incomplete recipe coverage, missing recipes, incomplete review evidence, invalid codes, orphan ingredients, and dangling recipe references. Verify the configured `MONGODB_URI` before running it; when unset, the script targets the local `nhahang` database.
3. Review the report with restaurant owners/operators. Prioritize known customer conflicts, dishes with candidate allergen conflicts, missing recipe references, and records marked reviewed without complete evidence. Do not treat a high number of unknowns as evidence of safety.
4. The optional safe backfill only writes defaults for missing status/coverage fields and demotes `REVIEWED` records whose evidence or declarations fail the same validation used by the APIs. It does not invent allergen values or promote any record to `REVIEWED`. It is guarded by exact database and host confirmation:

   ```powershell
   npm run audit:allergens -- --apply --confirm-db <database-name> --confirm-host <mongo-host>
   ```

   Run apply only against an explicitly reviewed target and after preserving the normal database backup/restore point for that environment. The script prints before and after reports. No apply/backfill is part of deployment or this code change.
5. Have each tenant use the dashboard queue to add source-backed ingredient and dish declarations. Review the audit again to confirm the unknown queue is shrinking and incomplete evidence is not being reintroduced.
6. Verify customer QR ordering, staff order details, and bill rows using a reviewed conflict, a reviewed-empty dish, and an unknown dish. Confirm that all remain orderable and that old order/bill snapshots remain unchanged after menu edits.

## Operational checks

- Track the count of `UNKNOWN` dishes and ingredients per restaurant, reviewed records missing evidence, incomplete recipe coverage, recomputation failures, and the age of the oldest unresolved customer-conflict candidate.
- Keep records `UNKNOWN` when the source is unclear, the recipe is incomplete, an ingredient cannot be resolved, or cross-contact information has not been reviewed.
- If a data issue is discovered, correct the ingredient/recipe source and re-review the affected dish. Do not edit old order or bill snapshots to match the latest menu declaration.
- This PR does not run audit apply mode or modify production data.
