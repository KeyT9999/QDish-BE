# QR Allergen Order Warnings Implementation Plan

**Implementation status (2026-10-03):** Local implementation and the BE/FE workflow checks are complete. The guest browser regression covers the free-plan QR flow, a declared conflict, UNKNOWN metadata, and successful order submission. FE unit tests cover non-conflicts; BE tests cover server snapshots, bill snapshots, and public-read privacy. Hosted CI remains pending because no branch push or PR was authorized. The repository audit commands found existing production dependency advisories; both workflows mark audit as continue-on-error.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make QR guests see useful allergen warnings while retaining the choice to order, and carry BE-computed, order-time warnings into restaurant order and bill views.

**Architecture:** Keep guest profile storage local. Send validated reported allergy codes with each order, resolve menu metadata on BE, and snapshot the server-computed status and conflicts on each order line and bill line. Treat unreviewed metadata as unknown and render it honestly.

**Tech Stack:** Existing React, TypeScript, Vite, Tailwind, Node.js 22, Express, Mongoose, Node assert tests, and Playwright. Add no dependencies.

## Global Constraints

- Use the seven existing allergy codes: GLUTEN, DAIRY, NUTS, SHELLFISH, SOY, EGGS, and FISH.
- Keep order warnings derived on BE from the restaurant-scoped MenuItem record.
- Never block a guest from ordering because of an allergy match or UNKNOWN allergen metadata.
- Keep UNKNOWN distinct from REVIEWED with an empty allergens list.
- Any recipe or allergen data change invalidates REVIEWED; confirming the new list is a separate status-only update.
- Preserve customer-authored Order.note semantics.
- Do not persist dining allergies in RestaurantCustomer, TableSession, logs, or analytics.
- Public table-scoped order history and current-bill responses must omit allergy snapshot fields; restaurant-authenticated order/bill views and the direct create-order response may include them.
- Target PR CI only. Do not push, merge, or deploy without explicit authorization.
- Make changes on feature branches in both repositories; keep the FE and BE API contract synchronized.

## File Map

### Backend

- Modify src/models/MenuItem.ts for allergen review status.
- Modify src/routes/menuRoutes.ts and src/services/nutritionService.ts to validate, serve, and invalidate review status when recipe inputs change.
- Create src/services/orderAllergenSnapshotService.ts for strict request parsing and the pure snapshot algorithm.
- Modify src/routes/orderRoutes.ts to resolve canonical metadata and persist the snapshots.
- Modify src/models/Order.ts for per-line snapshots and conditional order allergy context.
- Modify src/models/Bill.ts and src/services/billLifecycleService.ts to preserve conflicts and UNKNOWN allergy context in bill aggregation.
- Add focused Node assert tests and include them in package.json test:ci.

### Frontend

- Modify src/types/index.ts and src/services/menuService.ts for the review-status and snapshot contract.
- Modify src/services/diningProfileStorage.ts, src/hooks/useDiningProfile.ts, and src/pages/CustomerMenu.tsx so the allergy disclosure is available to all QR guests while goals/preferences retain entitlement gating.
- Modify src/components/dining/DiningOnboarding.tsx, src/components/menu/MenuItemCard.tsx, src/components/menu/MenuItemDetail.tsx, and cart components to explain conflicts without disabling order actions.
- Modify src/components/dashboard/restaurant/RestaurantMenuTab.tsx and Dashboard.tsx for the status-only allergen review action.
- Modify src/components/dashboard/restaurant/RestaurantOrdersTab.tsx, RestaurantBillsTab.tsx, and modals/CurrentBillModal.tsx to render persisted line warnings.
- Add pure presentation tests, a customer allergen Playwright regression, and its npm/workflow wiring.

## Task 0: Prepare isolated implementation branches

**Files:** None.

- [ ] Step 1: Confirm both BE and FE working trees are clean and currently based on their updated origin/main branches.
- [ ] Step 2: Record current required PR status checks and compare them with each repository’s .github/workflows/ci.yml. If required-check policy cannot be read before a PR exists, check it after the PR is opened.
- [ ] Step 3: Create a short-lived branch named feature/qr-allergen-order-warning in each repository.
- [ ] Step 4: Confirm each branch starts from the expected main commit and that no existing user work was moved or overwritten.

**Acceptance:** Implementation is isolated from main in both repositories, with the same feature name and a clean starting state.

## Task 1: Define and test the BE allergy snapshot algorithm

**Files:**
- Create: src/services/orderAllergenSnapshotService.ts
- Create: src/tests/orderAllergenSnapshot.test.ts
- Modify: package.json

**Interfaces:**
- Export parseReportedAllergies(value: unknown): { ok: true; allergies: string[] } | { ok: false }.
- Export type AllergenInfoStatus = "UNKNOWN" | "REVIEWED".
- Export interface OrderAllergenSnapshotInput { items: ReadonlyArray<{ menuItemId: string }>; menuItems: ReadonlyArray<{ id: string; allergens?: readonly string[]; allergenInfoStatus?: AllergenInfoStatus }>; reportedAllergies: readonly string[] }.
- Export buildOrderAllergenSnapshots(input: OrderAllergenSnapshotInput): Map<string, { allergenInfoStatus: AllergenInfoStatus; allergenWarnings: string[] }>.

```ts
const result = buildOrderAllergenSnapshots({
  items: [{ menuItemId: "dish-1" }, { menuItemId: "dish-2" }],
  menuItems: [
    { id: "dish-1", allergens: ["nuts"], allergenInfoStatus: "REVIEWED" },
    { id: "dish-2", allergens: [], allergenInfoStatus: "UNKNOWN" }
  ],
  reportedAllergies: ["NUTS"]
});

assert.deepEqual(result.get("dish-1"), {
  allergenInfoStatus: "REVIEWED",
  allergenWarnings: ["NUTS"]
});
assert.deepEqual(result.get("dish-2"), {
  allergenInfoStatus: "UNKNOWN",
  allergenWarnings: []
});
```

- [ ] Step 1: Add failing tests for accepted codes, whitespace/case normalization, duplicate and unknown-code rejection, REVIEWED intersection, empty REVIEWED metadata, UNKNOWN metadata, missing menu records, and duplicate menu lines.
- [ ] Step 2: Add the focused script test:order-allergen-snapshot and chain it into test:ci.
- [ ] Step 3: Run npm run test:order-allergen-snapshot and confirm the tests fail for the missing exports.
- [ ] Step 4: Implement parsing using DINING_ALLERGIES from diningProfileValidation.ts; reject more than seven entries and duplicates after normalization.
- [ ] Step 5: Implement one deterministic result for every submitted menuItemId. For REVIEWED metadata, return only the normalized intersection; for UNKNOWN or missing metadata, return UNKNOWN and no declared conflict.
- [ ] Step 6: Run npm run test:order-allergen-snapshot and confirm it passes.
- [ ] Step 7: Commit in the BE feature branch with message feat: calculate order allergen snapshots.

**Acceptance:** The pure service rejects invalid user input and calculates conflict from canonical item metadata only. No database or Express dependency is required by the pure tests.

## Task 2: Add explicit allergen metadata review state

**Files:**
- Modify: src/models/MenuItem.ts
- Modify: src/routes/menuRoutes.ts
- Modify: src/services/nutritionService.ts
- Create: src/tests/menuAllergenMetadata.test.ts
- Modify: package.json

- [ ] Step 1: Add a failing model/policy test showing that missing legacy review status resolves to UNKNOWN, REVIEWED with no allergens stays REVIEWED, and any recipe/allergen change resets status even if that same request asks to mark it REVIEWED.
- [ ] Step 2: Run the focused test and confirm the existing menu contract cannot represent the reviewed-empty distinction.
- [ ] Step 3: Add the Mongoose enum path allergenInfoStatus with values UNKNOWN and REVIEWED and default UNKNOWN for newly created items.
- [ ] Step 4: Normalize menu GET/create/update serialization so legacy records with no stored field return UNKNOWN; do not rely on lean-query defaults or run a mass migration.
- [ ] Step 5: Validate create/update requests against those enum values. Any recipe input change sets UNKNOWN regardless of a REVIEWED value in that same request; allow REVIEWED only on a status-only update after the latest derived allergen list is loaded.
- [ ] Step 6: Reset the review status to UNKNOWN whenever NutritionService recalculates allergens or clears a recipe; add the same behavior to a focused policy test.
- [ ] Step 7: Add test:menu-allergen-metadata to test:ci and run it.
- [ ] Step 8: Commit with message feat: track reviewed menu allergen data.

**Acceptance:** New records default to UNKNOWN and legacy records serialize as UNKNOWN. A reviewed item with no listed allergens is distinguishable from an unreviewed item. Recalculating recipe-derived allergens invalidates a prior review.

## Task 3: Compute and persist order-time snapshots on BE

**Files:**
- Modify: src/routes/orderRoutes.ts
- Modify: src/models/Order.ts
- Modify: src/services/orderAllergenSnapshotService.ts
- Create or extend: src/tests/orderAllergenOrderRoute.test.ts
- Modify: package.json

- [ ] Step 1: Add a failing route/service test where a guest reports NUTS and a REVIEWED menu item declares NUTS; expect a saved warning on only that matching line.
- [ ] Step 2: Add failing cases for a REVIEWED non-conflict, UNKNOWN metadata, absent reportedAllergies, malformed codes, forged client allergens/allergenWarnings, and two diners placing separate allergy snapshots at the same table.
- [ ] Step 3: Run focused tests and confirm order creation currently drops reportedAllergies and has no per-line warning snapshot.
- [ ] Step 4: Extend the order request parser with optional reportedAllergies. Return HTTP 400 for invalid codes, duplicates, unsupported values, or non-string entries; treat omission as an empty list.
- [ ] Step 5: Fetch distinct menu IDs scoped by restaurantId and read only _id, allergens, and allergenInfoStatus. Do not use allergens or warning fields supplied by the client.
- [ ] Step 6: Build server snapshots and attach allergenInfoStatus and allergenWarnings to each Order item before Order.create.
- [ ] Step 7: If allergies were reported and at least one line is UNKNOWN, retain reportedAllergies on that Order as staff context. Otherwise omit that full list and retain only actual per-line conflicts.
- [ ] Step 8: Keep existing customer order writes and bill linking behavior unchanged for conflicts and UNKNOWN metadata.
- [ ] Step 9: Run the focused order tests plus npm run test:restaurant-order-write and npm run test:customer-order-capture.
- [ ] Step 10: Commit with message feat: persist allergen warnings on customer orders.

**Acceptance:** The BE ignores forged client warning data, derives conflicts from restaurant-owned menu records, and never rejects a valid order because of an allergy result.

## Task 4: Preserve warnings through bill aggregation

**Files:**
- Modify: src/models/Bill.ts
- Modify: src/services/billLifecycleService.ts
- Modify: src/tests/tableBillLifecycle.test.ts

- [ ] Step 1: Add failing bill lifecycle cases for conflict codes and UNKNOWN status copying from Order item to Bill item snapshot.
- [ ] Step 2: Add a case proving otherwise-identical menu items with different allergen warning/status snapshots are not merged into one bill line.
- [ ] Step 3: Add a case proving UNKNOWN lines with different order-level reportedAllergies remain separate bill snapshots.
- [ ] Step 4: Run npm run test:table-bill and confirm bill snapshots currently omit allergen state.
- [ ] Step 5: Add allergenInfoStatus, allergenWarnings, and optional reportedAllergies to BillItemSnapshot with legacy-safe defaults.
- [ ] Step 6: Copy status/warnings in appendOrderToBill; copy order.reportedAllergies only onto UNKNOWN lines; include status, warnings, reportedAllergies, and the existing customer note in the snapshot merge identity.
- [ ] Step 7: Recompute totals using quantities/prices exactly as before and run npm run test:table-bill.
- [ ] Step 8: Commit with message feat: snapshot allergen warnings on bills.

**Acceptance:** Bill totals and payment behavior are unchanged. Each bill line retains the order-time alert state and conflicting lines do not collapse together.

## Task 5: Add merchant allergen review controls

**Files:**
- Modify: src/types/index.ts in FE
- Modify: src/services/menuService.ts in FE
- Modify: src/components/dashboard/restaurant/RestaurantMenuTab.tsx and src/pages/Dashboard.tsx in FE
- Add: focused metadata presentation or policy test under FE tests

- [ ] Step 1: Add a failing test for review-state labels and the rule that changing allergen tags clears the reviewed state until the restaurant confirms them again.
- [ ] Step 2: Extend FE MenuItem types and normalizeMenuItem to preserve allergenInfoStatus.
- [ ] Step 3: Show each item's declared allergen codes and review status in the restaurant menu list. Allow REVIEWED with an empty declared allergen set.
- [ ] Step 4: When an existing item’s recipe changes, show UNKNOWN after the save and require a separate confirmation action from the menu list after the updated data returns.
- [ ] Step 5: Save status-only confirmation through the existing menuService update request; do not add a new dependency or endpoint.
- [ ] Step 6: Run the focused FE test and npm run build.
- [ ] Step 7: Commit with message feat: let restaurants review allergen metadata.

**Acceptance:** Restaurant users can distinguish unreviewed information from a reviewed item with no declared allergens.

## Task 6: Make the allergy disclosure universal and ordering non-blocking

**Files:**
- Modify: src/services/diningProfileStorage.ts
- Modify: src/hooks/useDiningProfile.ts
- Modify: src/pages/CustomerMenu.tsx
- Modify: src/components/dining/DiningOnboarding.tsx
- Modify: src/components/menu/MenuItemCard.tsx
- Modify: src/components/menu/MenuItemDetail.tsx
- Modify: cart item presentation and related tests

- [ ] Step 1: Add failing policy tests showing that allergy disclosure eligibility is independent of personalizedMenuEnabled, while goals/preferences remain entitlement-gated.
- [ ] Step 2: Add a versioned “allergy disclosure handled” local-storage key. Preserve existing profile migration, prompt guests with no recorded allergy disclosure, and let guests explicitly skip or select no allergies.
- [ ] Step 3: Add localized labels for the seven allowed codes and a pure helper to compute FE display conflicts and UNKNOWN copy from the profile and menu metadata.
- [ ] Step 4: Render the named conflict under the menu item and in item details. Render the restaurant-unconfirmed message for UNKNOWN metadata when the guest has reported allergies, plus the cross-contact notice.
- [ ] Step 5: Remove the allergen check that rejects add-to-cart. Keep item availability checks and all unrelated order validation.
- [ ] Step 6: Keep add buttons enabled for conflict and UNKNOWN items and show a concise, non-blocking warning.
- [ ] Step 7: Show the current computed warning in cart lines, and add reportedAllergies to the create-order payload. Never send client-computed allergenWarnings as authoritative fields.
- [ ] Step 8: Add unit tests for labels, normalized case matching, no-conflict, UNKNOWN state, and local-storage migration; add them to test:ci.
- [ ] Step 9: Run focused profile and presentation tests plus npm run build.
- [ ] Step 10: Commit with message feat: allow informed allergen-aware ordering.

**Acceptance:** A guest can order a matching or UNKNOWN item after seeing its warning. A guest with no declared allergies sees no personalized conflict warning.

## Task 7: Render persisted warnings in staff and restaurant bill views

**Files:**
- Modify: src/types/index.ts in FE
- Modify: src/services/orderService.ts and src/services/billService.ts in FE
- Modify: src/components/dashboard/restaurant/RestaurantOrdersTab.tsx
- Modify: src/pages/StaffDashboard.tsx
- Modify: src/components/dashboard/restaurant/RestaurantBillsTab.tsx
- Modify: src/components/dashboard/restaurant/modals/CurrentBillModal.tsx
- Modify: src/services/customerOrderSerialization.ts in BE to redact snapshots from shared-table guest reads.

- [ ] Step 1: Add a failing pure presentation test for REVIEWED conflicts, UNKNOWN lines with reported allergy context, and no-warning lines.
- [ ] Step 2: Extend OrderItem and BillItemSnapshot FE types with allergenInfoStatus and allergenWarnings; extend Order and UNKNOWN BillItemSnapshot with optional reportedAllergies.
- [ ] Step 3: Render warnings below the exact item in RestaurantOrdersTab and the bill snapshot rows in RestaurantBillsTab and CurrentBillModal.
- [ ] Step 4: Display customer-authored order.note separately and unchanged.
- [ ] Step 5: Redact allergen status, conflict codes, and reported allergy codes from public customer order history and current-bill responses; retain the current order snapshot in the direct create response and full details on restaurant-authenticated views.
- [ ] Step 6: Run focused presentation tests, existing bill/order UI tests, and npm run build.
- [ ] Step 7: Commit with message feat: show allergen warnings on bills and orders.

**Acceptance:** Restaurant order and bill screens use the saved order-time state. Public shared-table views reveal no guest allergy data. Updating the menu later does not rewrite historical warnings.

## Task 8: Add browser regression for the complete QR order flow

**Files:**
- Create: tests/qr-allergen-order-warning.spec.ts
- Create: playwright.allergen.config.ts
- Modify: package.json
- Modify: .github/workflows/ci.yml

- [ ] Step 1: Add a failing Playwright test with mocked restaurant/menu/session/order APIs: open a QR menu with personalizedMenuEnabled false, select NUTS, see a conflict warning, add the item, and submit.
- [ ] Step 2: Assert that the add action stays enabled and the POST /api/orders body contains reportedAllergies with NUTS but no client-computed warning claim.
- [ ] Step 3: Cover UNKNOWN and REVIEWED non-conflict presentation in FE unit tests; cover public history redaction in BE serialization tests.
- [ ] Step 4: Add test:e2e:allergen with the new Playwright config.
- [ ] Step 5: Add a workflow step after Chromium installation and before build to run npm run test:e2e:allergen.
- [ ] Step 6: Run npm run test:e2e:allergen locally and resolve flakiness using accessible role/name selectors and mocked network responses.
- [ ] Step 7: Commit with message test: cover QR allergen order flow.

**Acceptance:** CI exercises the actual guest flow, including the critical requirement that a conflict warning does not disable ordering.

## Task 9: Run local equivalents of both repository CI workflows

**Files:**
- Modify only files required by the preceding tasks.

- [ ] Step 1: In BE, run npm ci and all workflow checks against the local MongoDB. The hosted workflow uses Node 22; this host provides Node 24.12.0.
- [ ] Step 2: Run BE focused tests, npm run test:ci, npm run build, and git diff --check.
- [ ] Step 3: In FE, run npm ci and npm run check:encoding. The hosted workflow uses Node 22; this host provides Node 24.12.0.
- [ ] Step 4: Run FE focused tests, npm run lint, npm run test:ci, the QR allergen E2E, and existing owner-insights, owner-sidebar, and order-status E2E commands.
- [ ] Step 5: Run npm run build and git diff --check in FE.
- [ ] Step 6: Review both diffs for API parity, no full profile leakage into CRM/logging, accessible warning labels, and no changes to payment totals or order availability logic.
- [ ] Step 7: Run npm audit --omit=dev --audit-level=high in both repos and report its actual result. The current workflows mark this step continue-on-error, so it is informative rather than a blocking quality check.
- [ ] Step 8: Commit any remaining workflow/test corrections in the appropriate feature branch and confirm both branches are clean.

## Task 10: Verify hosted checks on the PR head

- [ ] Step 1: After the user authorizes publishing branches and opening/updating a PR, inspect repository-required status checks and GitHub Actions.
- [ ] Step 2: Confirm every required BE and FE quality check is green for the exact latest PR head SHA; pending, cancelled, skipped-required, or action-required states do not count as pass.
- [ ] Step 3: If a check fails, inspect its job log, fix the root cause, rerun the affected local workflow commands, push only with authorization, and recheck the new PR head SHA.
- [ ] Step 4: Report production deployment separately. The deploy jobs run on pushes to main after quality succeeds; do not merge or deploy as part of PR verification.

## Checkpoints

### Checkpoint A: BE contract and persistence

- [ ] Tasks 1–4 pass.
- [ ] A matching reviewed allergen is stored on the correct Order and Bill item.
- [ ] UNKNOWN stays distinct and does not reject ordering.

### Checkpoint B: Guest and restaurant UI

- [ ] Tasks 5–8 pass.
- [ ] QR menu/cart show customer guidance; restaurant order and bill views show the persisted order-time warning; public table history and current-bill responses redact health data.
- [ ] Customer-authored notes and totals are unchanged.

### Checkpoint C: CI readiness

- [ ] Task 9 local BE and FE workflows pass.
- [ ] Task 10 hosted required checks pass on the exact PR head SHA after authorized publishing.
