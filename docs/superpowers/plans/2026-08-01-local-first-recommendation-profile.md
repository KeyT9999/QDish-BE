# Local-First Recommendation Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Fit Score and Recommendation consume the same browser-owned anonymous dining profile while preserving legacy clients, enforcing allergen safety, and clearly separating general from personalized recommendations.

**Architecture:** The frontend owns a versioned `qdish_dining_profile` envelope and sends a sanitized snapshot with each Recommendation request. The backend validates that snapshot using shared dining-profile primitives, never reads `UserDiningProfile` in the Recommendation path, and returns an explicit mode plus deterministic empty reasons. Recommendation scoring is made testable through injected data dependencies and filters unsafe dishes before ranking or pairing.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Express 4, TypeScript 5, Mongoose 8, Node assertion tests via `tsx`/`--experimental-strip-types`, Playwright 1.60.

## Global Constraints

- Work only on branch `Thang_AI` in both repositories; do not merge to `main`.
- `qdish_dining_profile` is global to the browser, schema version is exactly `1`, and the profile has no automatic expiry.
- Recommendation sends and consumes only `goals`, `preferences`, and `allergies`; `conditions` stays local.
- `userId` remains accepted for compatibility but is ignored and must never cause a `UserDiningProfile` query.
- `PERSONALIZED` requires at least one goal or preference; allergies alone remain `GENERAL`.
- Allergies are hard constraints across `bestForYou`, `fullMenu`, and pairing candidates, with no unsafe fallback.
- Keep the current Recommendation subscription entitlement behavior unchanged.
- Keep `UserDiningProfile` and its old routes operational, but mark those routes deprecated in code documentation.
- Preserve the existing response arrays and item fields; `mode` and `emptyReason` are additive.
- General UI copy is `Gợi ý phù hợp lúc này`; personalized UI copy is `Gợi ý dành cho bạn`.
- No-safe-dish copy is `Chưa tìm thấy món phù hợp với dị ứng đã chọn`.

---

## File Structure

### Backend repository: `QR_FOOD_ORDER_BE`

- Create `src/services/diningProfileValidation.ts`: shared enums, bounded-array validation, strict Recommendation context validation, and normalized request types; the batch Fit Score validator retains its currently accepted `cool` weather and free-form string occasion for backward compatibility.
- Create `src/tests/diningProfileValidation.test.ts`: pure boundary and injection tests for the shared validator.
- Modify `src/routes/fitScoreRoutes.ts`: delegate batch input validation to the shared validator without changing route behavior.
- Modify `src/engines/recommendation/RecommendationEngine.ts`: add response mode/empty reason, injected menu/nutrition readers, context-aware general ranking, and hard allergen filtering.
- Create `src/tests/recommendationEnginePolicy.test.ts`: database-free policy tests for modes, ranking, safety, and pairings.
- Modify `src/routes/recommendationRoutes.ts`: validate inline profile, ignore legacy `userId`, inject route dependencies, and remove `UserDiningProfile` access.
- Create `src/tests/recommendationRoutes.test.ts`: handler-level validation, compatibility, entitlement, and call-order tests.
- Modify `src/routes/userProfileRoutes.ts` (or the actual route file exporting `/api/users/profile/:userId` after locating it with `rg`): add deprecation JSDoc/comments only; preserve runtime behavior.
- Modify `package.json`: add focused test scripts for shared validation, Recommendation policy, and Recommendation route behavior.

### Frontend repository: `QR_FOOD_ORDER_FE`

- Create `src/services/diningProfileStorage.ts`: versioned envelope parsing, normalization, migration, save, and clear operations.
- Create `tests/diningProfileStorage.test.ts`: localStorage-double tests for migration and lifecycle behavior.
- Modify `src/hooks/useDiningProfile.ts`: use the storage service and expose `updatedAt` and `clearProfile`.
- Create `src/services/recommendationService.ts`: typed request construction, API call, mode/title/empty-copy helpers.
- Create `tests/recommendationService.test.ts`: serialization and presentation tests.
- Modify `src/components/dining/DiningOnboarding.tsx`: remove guest `userId` and server-profile write while keeping restaurant-scoped analytics non-blocking.
- Modify `src/components/dining/DiningProfileForm.tsx`: add confirmed persistent clear action.
- Modify `src/pages/CustomerMenu.tsx`: remove generated guest ID, use the shared time bucket and typed client, render mode/empty reason, and wire profile clearing.
- Create `tests/local-first-recommendation.spec.ts`: Playwright coverage for onboarding, general/personalized modes, allergen safety, editing, and clearing.
- Create `playwright.recommendation.config.ts`: focused browser-test configuration reusing the established Fit Score test-server pattern.
- Modify `package.json`: add unit and browser scripts for this feature.

---

### Task 1: Shared backend request validation

**Files:**
- Create: `QR_FOOD_ORDER_BE/src/services/diningProfileValidation.ts`
- Create: `QR_FOOD_ORDER_BE/src/tests/diningProfileValidation.test.ts`
- Modify: `QR_FOOD_ORDER_BE/src/routes/fitScoreRoutes.ts`
- Modify: `QR_FOOD_ORDER_BE/package.json`

**Interfaces:**
- Produces: `DiningProfileSnapshot`, `RecommendationContextInput`, `RecommendationRequestInput`, `isValidBatchFitScoreInput(value)`, and `parseRecommendationRequest(value)`.
- `parseRecommendationRequest` returns `{ ok: true, value } | { ok: false }`; its successful value contains only validated fields and may contain deprecated `userId` without using it.

- [ ] **Step 1: Write failing pure validator tests**

```ts
import assert from "node:assert/strict";
import {
  isValidBatchFitScoreInput,
  parseRecommendationRequest,
} from "../services/diningProfileValidation.js";

const restaurantId = "507f1f77bcf86cd799439011";
assert.equal(parseRecommendationRequest({ restaurantId }).ok, true);
assert.equal(parseRecommendationRequest({ restaurantId, userId: "legacy-guest" }).ok, true);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  goals: ["BALANCED"], preferences: [], allergies: ["NUTS"],
}}).ok, true);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  goals: [], preferences: [], allergies: [], conditions: ["DIABETES"],
}}).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, userProfile: {
  goals: ["BALANCED", "BALANCED"], preferences: [], allergies: [],
}}).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, context: { weather: "storm" } }).ok, false);
assert.equal(parseRecommendationRequest({ restaurantId, context: { occasion: { $ne: null } } }).ok, false);
assert.equal(isValidBatchFitScoreInput({ restaurantId, userProfile: {
  goals: [], preferences: [], allergies: [],
}}), true);
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `cd QR_FOOD_ORDER_BE && npx tsx src/tests/diningProfileValidation.test.ts`

Expected: FAIL because `diningProfileValidation.ts` does not exist.

- [ ] **Step 3: Implement exact shared contracts and validators**

```ts
export const DINING_GOALS = ["MUSCLE_GAIN", "ENERGY_BOOST", "LIGHT_MEAL", "COMFORT", "BALANCED", "WEIGHT_LOSS", "MAINTENANCE", "GENERAL_HEALTH"] as const;
export const DINING_PREFERENCES = ["VEGAN", "VEGETARIAN", "LOW_CARB", "HIGH_PROTEIN", "KETO", "GLUTEN_FREE", "LOW_FAT", "SUGAR_FREE"] as const;
export const DINING_ALLERGIES = ["GLUTEN", "DAIRY", "NUTS", "SHELLFISH", "SOY", "EGGS", "FISH"] as const;

export interface DiningProfileSnapshot {
  goals: string[];
  preferences: string[];
  allergies: string[];
}

export interface RecommendationContextInput {
  timeOfDay?: "breakfast" | "lunch" | "dinner" | "late_night";
  postWorkout?: boolean;
  weather?: "hot" | "cold" | "rainy";
  occasion?: "casual" | "date" | "family";
}

export interface RecommendationRequestInput {
  restaurantId: string;
  userProfile?: DiningProfileSnapshot;
  context?: RecommendationContextInput;
  userId?: string;
}
```

Implement `isRecord`, exact-key checks, Mongo ObjectId validation, maximum length 10, duplicate rejection, enum membership, and strict context fields. Recommendation allows omission of `userProfile`; batch Fit Score still requires it. Reject unknown keys inside `userProfile` and `context`, and reject unknown top-level fields. Validate an optional legacy `userId` as a string but never return it as an engine input. Keep batch Fit Score's existing context acceptance unchanged: weather also accepts `cool`, and occasion remains any string; only Recommendation narrows occasion to `casual | date | family`.

- [ ] **Step 4: Refactor the Fit Score batch route to call the shared validator**

```ts
import { isValidBatchFitScoreInput } from "../services/diningProfileValidation.js";

// Delete the duplicated ALLOWED_* sets and local validator helpers.
if (!isValidBatchFitScoreInput(req.body)) {
  return res.status(400).json({
    error: { code: "INVALID_FIT_SCORE_REQUEST", message: "Yêu cầu Fit Score không hợp lệ" },
  });
}
```

- [ ] **Step 5: Add and run focused scripts**

```json
"test:dining-profile-validation": "tsx src/tests/diningProfileValidation.test.ts"
```

Run: `cd QR_FOOD_ORDER_BE && npm run test:dining-profile-validation && npm run test:batch-fit-score && npm run build`

Expected: all commands PASS and existing Fit Score status/error contracts remain unchanged.

- [ ] **Step 6: Commit the validation boundary**

```bash
git add src/services/diningProfileValidation.ts src/tests/diningProfileValidation.test.ts src/routes/fitScoreRoutes.ts package.json
git commit -m "refactor: share dining profile request validation"
```

### Task 2: Recommendation engine modes and allergen-safe policy

**Files:**
- Modify: `QR_FOOD_ORDER_BE/src/engines/recommendation/RecommendationEngine.ts`
- Create: `QR_FOOD_ORDER_BE/src/tests/recommendationEnginePolicy.test.ts`
- Modify: `QR_FOOD_ORDER_BE/package.json`

**Interfaces:**
- Consumes: `DiningProfileSnapshot` and `RecommendationContextInput` from Task 1.
- Produces: `RecommendationMode`, `RecommendationEmptyReason`, additive `RecommendationResponse`, and optional `RecommendationEngineDependencies` accepted by `generateRecommendations`.

- [ ] **Step 1: Write failing database-free policy tests**

Create fixtures with one safe main dish, one menu-allergen dish, one nutrition-profile-allergen side dish, and injected readers:

```ts
const dependencies = {
  findMenuItems: async () => [safeMain, menuNutDish, cachedDairySide],
  findNutritionProfiles: async () => [cachedDairyProfile],
};

const general = await RecommendationEngine.generateRecommendations(
  restaurantId, undefined, { timeOfDay: "dinner" }, dependencies
);
assert.equal(general.mode, "GENERAL");

const personalized = await RecommendationEngine.generateRecommendations(
  restaurantId, { goals: ["BALANCED"], preferences: [], allergies: [] }, undefined, dependencies
);
assert.equal(personalized.mode, "PERSONALIZED");

const allergiesOnly = await RecommendationEngine.generateRecommendations(
  restaurantId, { goals: [], preferences: [], allergies: ["dairy", "NUTS"] }, undefined, dependencies
);
assert.equal(allergiesOnly.mode, "GENERAL");
assert.equal(allergiesOnly.fullMenu.some(({ dish }) => dish.name === "Nut dish"), false);
assert.equal(allergiesOnly.fullMenu.some(({ dish }) => dish.name === "Cached dairy side"), false);
assert.equal(allergiesOnly.pairingSuggestions.some(({ pairedDish }) => pairedDish.name === "Cached dairy side"), false);
```

Also assert `NO_AVAILABLE_DISHES` for an empty menu, `NO_ALLERGEN_SAFE_DISHES` when all available dishes conflict, unchanged array keys, preference-only personalized mode, and that general reason text excludes `của bạn`.

- [ ] **Step 2: Run the policy test and confirm mode assertions fail**

Run: `cd QR_FOOD_ORDER_BE && npx tsx src/tests/recommendationEnginePolicy.test.ts`

Expected: FAIL because mode, empty reason, dependency injection, and complete allergen filtering are absent.

- [ ] **Step 3: Add testable engine contracts and safe data loading**

```ts
export type RecommendationMode = "GENERAL" | "PERSONALIZED";
export type RecommendationEmptyReason = "NO_AVAILABLE_DISHES" | "NO_ALLERGEN_SAFE_DISHES";

export interface RecommendationEngineDependencies {
  findMenuItems(restaurantId: mongoose.Types.ObjectId): Promise<IMenuItem[]>;
  findNutritionProfiles(dishIds: unknown[]): Promise<IDishNutritionProfile[]>;
}

export interface RecommendationResponse {
  mode: RecommendationMode;
  emptyReason?: RecommendationEmptyReason;
  bestForYou: RecommendedDish[];
  fullMenu: ScoredDish[];
  pairingSuggestions: PairingSuggestion[];
}
```

Default dependencies wrap the existing Mongoose queries. Return `NO_AVAILABLE_DISHES` immediately when no available items exist. Build a case-insensitive union from `dish.allergens` and `cachedProf.allergens`, then remove conflicts before pushing any scored item.

- [ ] **Step 4: Implement mode-specific ranking without a fabricated default goal**

```ts
const mode: RecommendationMode = userProfile
  && (userProfile.goals.length > 0 || userProfile.preferences.length > 0)
  ? "PERSONALIZED"
  : "GENERAL";
const resolvedType = FitScoreEngine.resolvePrimaryScoreType(userProfile);
const primaryScore = resolvedType ? (fitScores[resolvedType] ?? bestFit.score) : bestFit.score;
```

For personalized requests with only a preference, use `bestFit`. General reason text describes the meal context/dish and never claims personal preference. Pair only from the already-safe dish collection. If the original menu is non-empty but safe dishes are empty, return all three arrays empty with `NO_ALLERGEN_SAFE_DISHES`.

- [ ] **Step 5: Run focused engine tests and build**

Add:

```json
"test:recommendation-engine": "tsx src/tests/recommendationEnginePolicy.test.ts"
```

Run: `cd QR_FOOD_ORDER_BE && npm run test:recommendation-engine && npm run test:batch-fit-score && npm run build`

Expected: PASS; no test connects to MongoDB.

- [ ] **Step 6: Commit the policy change**

```bash
git add src/engines/recommendation/RecommendationEngine.ts src/tests/recommendationEnginePolicy.test.ts package.json
git commit -m "feat: make recommendations mode-aware and allergen-safe"
```

### Task 3: Inline Recommendation route and legacy compatibility

**Files:**
- Modify: `QR_FOOD_ORDER_BE/src/routes/recommendationRoutes.ts`
- Create: `QR_FOOD_ORDER_BE/src/tests/recommendationRoutes.test.ts`
- Modify: `QR_FOOD_ORDER_BE/package.json`

**Interfaces:**
- Consumes: `parseRecommendationRequest` from Task 1 and `RecommendationEngine.generateRecommendations` from Task 2.
- Produces: `createRecommendationHandler(dependencies)` for isolated handler tests and the unchanged default Express router export.

- [ ] **Step 1: Write failing route tests with injected spies**

```ts
const calls: string[] = [];
const handler = createRecommendationHandler({
  resolveOwnerByRestaurant: async () => { calls.push("owner"); return "owner-id" as never; },
  getPlanLimits: async () => ({ plan: { recommendationEnabled: true } } as never),
  generateRecommendations: async (_restaurantId, profile, context) => {
    calls.push(JSON.stringify({ profile, context }));
    return { mode: "GENERAL", bestForYou: [], fullMenu: [], pairingSuggestions: [] };
  },
});
```

Assert invalid ObjectId, object injection, invalid arrays, duplicates, unknown enum, and invalid context return 400 before `calls` changes. Assert inline arrays reach the engine unchanged. Assert a `userId`-only request passes `undefined` profile, returns GENERAL, and has no injected/model profile reader. Assert 404 and 403 behavior remain intact and unexpected errors return only the generic 500 message.

- [ ] **Step 2: Run the route test and verify factory export is missing**

Run: `cd QR_FOOD_ORDER_BE && npx tsx src/tests/recommendationRoutes.test.ts`

Expected: FAIL because `createRecommendationHandler` is not exported.

- [ ] **Step 3: Implement the dependency-injected route handler**

```ts
interface RecommendationRouteDependencies {
  resolveOwnerByRestaurant: typeof resolveOwnerByRestaurant;
  getPlanLimits: typeof getPlanLimits;
  generateRecommendations: typeof RecommendationEngine.generateRecommendations;
}

export const createRecommendationHandler = (dependencies = defaultDependencies) =>
  async (req: Request, res: Response) => {
    const parsed = parseRecommendationRequest(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ message: "Yêu cầu gợi ý món ăn không hợp lệ." });
    }
    // Keep current owner/plan checks, then pass only restaurantId, userProfile, context.
  };
```

Remove the `UserDiningProfile` import and all `findOne({ userId })` logic. Do not spread the request body into engine arguments.

- [ ] **Step 4: Add the focused script and run route regression**

```json
"test:recommendation-routes": "tsx src/tests/recommendationRoutes.test.ts"
```

Run: `cd QR_FOOD_ORDER_BE && npm run test:recommendation-routes && npm run test:recommendation-engine && npm run build`

Expected: PASS and `rg -n "UserDiningProfile|findOne.*userId" src/routes/recommendationRoutes.ts` returns no matches.

- [ ] **Step 5: Commit the route migration**

```bash
git add src/routes/recommendationRoutes.ts src/tests/recommendationRoutes.test.ts package.json
git commit -m "fix: use inline profiles for recommendations"
```

### Task 4: Versioned local profile storage

**Files:**
- Create: `QR_FOOD_ORDER_FE/src/services/diningProfileStorage.ts`
- Create: `QR_FOOD_ORDER_FE/tests/diningProfileStorage.test.ts`
- Modify: `QR_FOOD_ORDER_FE/src/hooks/useDiningProfile.ts`
- Modify: `QR_FOOD_ORDER_FE/package.json`

**Interfaces:**
- Produces: `StoredDiningProfile`, `EMPTY_DINING_PROFILE`, `loadDiningProfile(storage)`, `saveDiningProfile(storage, profile, now?)`, and `clearDiningProfile(storage)`.
- Hook returns `{ profile, updatedAt, saveProfile, clearProfile }` while preserving existing callers of `profile` and `saveProfile`.

- [ ] **Step 1: Write failing storage lifecycle tests**

```ts
const storage = createMemoryStorage();
storage.setItem("qdish_dining_profile", JSON.stringify({
  goals: ["BALANCED", "BALANCED"], preferences: ["VEGAN"], allergies: [], conditions: [],
}));
const migrated = loadDiningProfile(storage);
assert.deepEqual(migrated.profile.goals, ["BALANCED"]);
assert.equal(migrated.schemaVersion, 1);
assert.equal(JSON.parse(storage.getItem("qdish_dining_profile")!).schemaVersion, 1);

storage.setItem("qdish_dining_profile", JSON.stringify({ schemaVersion: 2, profile: {} }));
assert.deepEqual(loadDiningProfile(storage).profile, EMPTY_DINING_PROFILE);
```

Also test migration/removal of `qdish_health_profile`, invalid JSON/shape, filtering unknown/non-string entries, ISO `updatedAt`, immutable empty defaults, and clear removing the key.

- [ ] **Step 2: Run the storage test and verify the service is missing**

Run: `cd QR_FOOD_ORDER_FE && node --experimental-strip-types tests/diningProfileStorage.test.ts`

Expected: FAIL because `diningProfileStorage.ts` does not exist.

- [ ] **Step 3: Implement the versioned envelope and migration**

```ts
export interface StoredDiningProfile {
  schemaVersion: 1;
  updatedAt: string;
  profile: DiningProfile;
}

export function saveDiningProfile(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  profile: DiningProfile,
  now = new Date()
): StoredDiningProfile;
```

Normalize each array to known enum values, remove duplicates while retaining input order, create a fresh object on every return, and never throw on unavailable/malformed storage. A valid version-1 envelope must have a parseable ISO timestamp and valid profile object.

- [ ] **Step 4: Update the hook to use lazy loading and expose metadata**

```ts
const initial = loadDiningProfile(window.localStorage);
const [profile, setProfile] = useState(initial.profile);
const [updatedAt, setUpdatedAt] = useState<string | undefined>(initial.updatedAt);

const saveProfile = (next: DiningProfile) => {
  const stored = saveDiningProfile(window.localStorage, next);
  setProfile(stored.profile);
  setUpdatedAt(stored.updatedAt);
};
```

`clearProfile` must remove storage and synchronously set a fresh empty profile plus `updatedAt` undefined.

- [ ] **Step 5: Add the script, run tests, and build**

```json
"test:dining-profile-storage": "node --experimental-strip-types tests/diningProfileStorage.test.ts"
```

Run: `cd QR_FOOD_ORDER_FE && npm run test:dining-profile-storage && npm run test:fit-score-client && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit local profile persistence**

```bash
git add src/services/diningProfileStorage.ts tests/diningProfileStorage.test.ts src/hooks/useDiningProfile.ts package.json
git commit -m "feat: version local dining profiles"
```

### Task 5: Typed Recommendation client and presentation contract

**Files:**
- Create: `QR_FOOD_ORDER_FE/src/services/recommendationService.ts`
- Create: `QR_FOOD_ORDER_FE/tests/recommendationService.test.ts`
- Modify: `QR_FOOD_ORDER_FE/package.json`

**Interfaces:**
- Consumes: frontend `DiningProfile`, `apiFetch`, and `getTimeOfDayBucket` output.
- Produces: `RecommendationMode`, `RecommendationResponse`, `loadRecommendations(input)`, `getRecommendationHeading(mode)`, and `getRecommendationEmptyMessage(emptyReason)`.

- [ ] **Step 1: Write failing serialization and copy tests**

```ts
await loadRecommendations({
  restaurantId,
  profile: { goals: ["BALANCED"], preferences: ["VEGAN"], allergies: ["NUTS"], conditions: ["DIABETES"] },
  context: { timeOfDay: "lunch", postWorkout: false },
  fetcher,
});
assert.deepEqual(JSON.parse(fetcher.body), {
  restaurantId,
  userProfile: { goals: ["BALANCED"], preferences: ["VEGAN"], allergies: ["NUTS"] },
  context: { timeOfDay: "lunch", postWorkout: false },
});
assert.equal(fetcher.body.includes("conditions"), false);
assert.equal(fetcher.body.includes("userId"), false);
assert.equal(getRecommendationHeading("GENERAL"), "Gợi ý phù hợp lúc này");
assert.equal(getRecommendationHeading("PERSONALIZED"), "Gợi ý dành cho bạn");
assert.equal(getRecommendationEmptyMessage("NO_ALLERGEN_SAFE_DISHES"), "Chưa tìm thấy món phù hợp với dị ứng đã chọn");
```

- [ ] **Step 2: Run the test and verify the service is missing**

Run: `cd QR_FOOD_ORDER_FE && node --experimental-strip-types tests/recommendationService.test.ts`

Expected: FAIL because `recommendationService.ts` does not exist.

- [ ] **Step 3: Implement the typed client and deterministic presentation helpers**

```ts
export async function loadRecommendations(input: {
  restaurantId: string;
  profile: DiningProfile;
  context: RecommendationContext;
  fetcher: typeof apiFetch;
}): Promise<RecommendationResponse> {
  return input.fetcher<RecommendationResponse>("/api/recommendations", {
    method: "POST",
    requireAuth: false,
    body: JSON.stringify({
      restaurantId: input.restaurantId,
      userProfile: {
        goals: input.profile.goals,
        preferences: input.profile.preferences,
        allergies: input.profile.allergies,
      },
      context: input.context,
    }),
  });
}
```

Match the established `loadBatchFitScores` dependency-injection pattern by requiring a typed `fetcher` and passing `apiFetch` from `CustomerMenu`. Validate the returned mode before exposing it to UI; a malformed response should reject and remain non-blocking in `CustomerMenu`.

- [ ] **Step 4: Add script, run focused tests, and build**

```json
"test:recommendation-client": "node --experimental-strip-types tests/recommendationService.test.ts"
```

Run: `cd QR_FOOD_ORDER_FE && npm run test:recommendation-client && npm run test:fit-score-client && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit the frontend contract**

```bash
git add src/services/recommendationService.ts tests/recommendationService.test.ts package.json
git commit -m "feat: add typed recommendation client"
```

### Task 6: Local-only onboarding and confirmed profile clearing

**Files:**
- Modify: `QR_FOOD_ORDER_FE/src/components/dining/DiningOnboarding.tsx`
- Modify: `QR_FOOD_ORDER_FE/src/components/dining/DiningProfileForm.tsx`
- Create: `QR_FOOD_ORDER_FE/tests/diningProfileUiPolicy.test.ts`
- Modify: `QR_FOOD_ORDER_FE/package.json`

**Interfaces:**
- `DiningOnboardingProps` removes `userId`; `onComplete(profile)` remains the local save boundary.
- `DiningProfileFormProps` adds `onClearProfile?: () => void`.

- [ ] **Step 1: Write failing source-policy tests for forbidden guest-profile calls**

```ts
const onboarding = readFileSync("src/components/dining/DiningOnboarding.tsx", "utf8");
assert.equal(onboarding.includes("/api/users/profile/"), false);
assert.equal(onboarding.includes("userId:"), false);
assert.equal(onboarding.includes("recordDiningVisit"), true);

const form = readFileSync("src/components/dining/DiningProfileForm.tsx", "utf8");
assert.equal(form.includes("Xóa hồ sơ ăn uống"), true);
assert.equal(form.includes("window.confirm"), true);
```

- [ ] **Step 2: Run the UI policy test and verify it fails**

Run: `cd QR_FOOD_ORDER_FE && node --experimental-strip-types tests/diningProfileUiPolicy.test.ts`

Expected: FAIL because onboarding still calls the profile API and the persistent clear action is absent.

- [ ] **Step 3: Remove backend profile persistence from onboarding**

```ts
interface DiningOnboardingProps {
  open: boolean;
  onClose: () => void;
  onComplete: (profile: DiningProfile) => void;
  restaurantId: string;
  tableSessionId?: string;
}
```

Call `onComplete(profileData)` before analytics. Keep `recordDiningVisit` inside its own `try/catch` so analytics failure cannot prevent local completion. Remove the broad fallback that currently calls `onComplete` a second time after a failed profile POST.

- [ ] **Step 4: Add explicit, confirmed persistent clearing**

```ts
const hasStoredSelections = [
  ...initialProfile.goals,
  ...initialProfile.preferences,
  ...initialProfile.allergies,
  ...initialProfile.conditions,
].length > 0;

const handleClearProfile = () => {
  if (!window.confirm("Xóa mục tiêu, sở thích, dị ứng và tình trạng đã lưu trên thiết bị này?")) return;
  onClearProfile?.();
  onClose();
};
```

Render `Xóa hồ sơ ăn uống` only when `onClearProfile` exists and `hasStoredSelections` is true. Keep the existing form-only `Đặt lại` behavior distinct from persistent deletion.

- [ ] **Step 5: Add script, run tests, and build**

```json
"test:dining-profile-ui": "node --experimental-strip-types tests/diningProfileUiPolicy.test.ts"
```

Run: `cd QR_FOOD_ORDER_FE && npm run test:dining-profile-ui && npm run test:dining-profile-storage && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit the local-only UI path**

```bash
git add src/components/dining/DiningOnboarding.tsx src/components/dining/DiningProfileForm.tsx tests/diningProfileUiPolicy.test.ts package.json
git commit -m "fix: keep anonymous dining profiles on device"
```

### Task 7: CustomerMenu integration and mode-aware rendering

**Files:**
- Modify: `QR_FOOD_ORDER_FE/src/pages/CustomerMenu.tsx`
- Modify: `QR_FOOD_ORDER_FE/tests/recommendationService.test.ts`

**Interfaces:**
- Consumes: `loadRecommendations`, mode/copy helpers, `clearProfile`, and the existing scheduled `timeOfDayBucket`.
- Produces: a single React profile state that re-triggers Recommendation and Fit Score after save or clear.

- [ ] **Step 1: Extend failing integration-policy assertions**

```ts
const customerMenu = readFileSync("src/pages/CustomerMenu.tsx", "utf8");
assert.equal(customerMenu.includes("qdish_guest_user_id"), false);
assert.equal(customerMenu.includes("guestUserId"), false);
assert.equal(customerMenu.includes("loadRecommendations"), true);
assert.equal(customerMenu.includes("timeOfDay: timeOfDayBucket"), true);
assert.equal(customerMenu.includes("onClearProfile={clearProfile}"), true);
```

- [ ] **Step 2: Run the client test and verify the integration assertions fail**

Run: `cd QR_FOOD_ORDER_FE && npm run test:recommendation-client`

Expected: FAIL on current `CustomerMenu` guest-ID and raw-fetch behavior.

- [ ] **Step 3: Replace raw Recommendation state/fetch with the typed response**

```ts
const [recommendationResult, setRecommendationResult] = useState<RecommendationResponse | null>(null);
const recommendations = recommendationResult?.bestForYou ?? [];
const pairingSuggestions = recommendationResult?.pairingSuggestions ?? [];

const data = await loadRecommendations({
  restaurantId,
  profile,
  context: {
    timeOfDay: timeOfDayBucket,
    postWorkout: profile.goals.includes("MUSCLE_GAIN"),
  },
  fetcher: apiFetch,
});
```

Remove `guestUserId` creation and dependency. Include `restaurant`, `restaurantId`, `profile`, `isLoading`, and `timeOfDayBucket` in the effect dependencies. Clear stale response when Recommendation is unavailable or a request fails; never fall back to server profile data.

- [ ] **Step 4: Render server mode, safety empty state, and Fit Score eligibility**

```tsx
<h3>{getRecommendationHeading(recommendationResult.mode)}</h3>
{recommendationResult.emptyReason === "NO_ALLERGEN_SAFE_DISHES" && (
  <p role="status">{getRecommendationEmptyMessage(recommendationResult.emptyReason)}</p>
)}
```

Render the Recommendation section for a safety empty state even when `bestForYou` is empty. In GENERAL mode, do not pass legacy Recommendation score into `selectRecommendationFitScore`; independent Fit Score remains governed by its own feature/profile rules. Wire `DiningProfileForm` with `onClearProfile={clearProfile}` and remove `userId` from `DiningOnboarding`.

- [ ] **Step 5: Run frontend unit tests and build**

Run: `cd QR_FOOD_ORDER_FE && npm run test:recommendation-client && npm run test:dining-profile-storage && npm run test:dining-profile-ui && npm run test:fit-score-client && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit the unified frontend flow**

```bash
git add src/pages/CustomerMenu.tsx tests/recommendationService.test.ts
git commit -m "feat: unify recommendation and Fit Score profiles"
```

### Task 8: Deprecation markers and browser regression coverage

**Files:**
- Modify: `QR_FOOD_ORDER_BE/src/routes/userProfileRoutes.ts` or the route file found by `rg -n "profile/:userId|/onboarding" QR_FOOD_ORDER_BE/src/routes`
- Create: `QR_FOOD_ORDER_FE/tests/local-first-recommendation.spec.ts`
- Create: `QR_FOOD_ORDER_FE/playwright.recommendation.config.ts`
- Modify: `QR_FOOD_ORDER_FE/package.json`

**Interfaces:**
- Consumes all prior tasks.
- Produces no new runtime API; supplies migration documentation and end-to-end proof.

- [ ] **Step 1: Mark legacy server-profile routes deprecated without changing behavior**

```ts
/**
 * @deprecated Anonymous dining profiles are local-first. Kept temporarily for old clients;
 * Recommendation must not use this route/model as a fallback.
 */
```

Apply the marker to both the legacy read/write profile route and onboarding route. Do not delete the model, schema, indexes, or route registration.

- [ ] **Step 2: Write Playwright tests with intercepted API contracts**

```ts
test("onboarding stores locally and never calls guest profile API", async ({ page }) => {
  const profileCalls: string[] = [];
  await page.route("**/api/users/profile/**", route => {
    profileCalls.push(route.request().url());
    return route.abort();
  });
  // Complete onboarding, then assert the version-1 envelope and zero calls.
  expect(profileCalls).toEqual([]);
});
```

Add independent tests for:

- GENERAL response renders `Gợi ý phù hợp lúc này` and no legacy personalized Fit Score badge.
- PERSONALIZED response renders `Gợi ý dành cho bạn`.
- Allergies-only request contains inline allergies, remains GENERAL, and blocked dishes are absent.
- `NO_ALLERGEN_SAFE_DISHES` renders the approved safety copy.
- Editing the profile causes both `/api/recommendations` and `/api/dishes/fit-scores` to receive updated goals/preferences/allergies.
- Clearing requires confirmation; cancel preserves storage; confirm removes storage, sends an empty inline profile, returns to GENERAL, and hides personalized Fit Score.
- Recommendation network failure leaves menu cards and cart controls usable.

- [ ] **Step 3: Configure the isolated browser suite**

Reuse the existing `playwright.fit-score.config.ts` web-server and base URL pattern:

```ts
export default defineConfig({
  testDir: "./tests",
  testMatch: "local-first-recommendation.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4176", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4176 --strictPort",
    url: "http://127.0.0.1:4176",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
```

Add:

```json
"test:e2e:recommendation": "playwright test --config playwright.recommendation.config.ts"
```

- [ ] **Step 4: Run the browser suite and fix only failures within this feature scope**

Run: `cd QR_FOOD_ORDER_FE && npm run test:e2e:recommendation`

Expected: all scenarios PASS with no request to `/api/users/profile/**`.

- [ ] **Step 5: Commit deprecation and browser proof in their respective repositories**

```bash
cd QR_FOOD_ORDER_BE
git add src/routes
git commit -m "docs: deprecate anonymous server profiles"

cd ../QR_FOOD_ORDER_FE
git add tests/local-first-recommendation.spec.ts playwright.recommendation.config.ts package.json
git commit -m "test: cover local-first recommendation flow"
```

### Task 9: Full verification and branch readiness

**Files:**
- Verify only; do not change generated artifacts or unrelated user files.

**Interfaces:**
- Consumes all deliverables.
- Produces evidence that both `Thang_AI` branches are ready for the user's manual merge.

- [ ] **Step 1: Run the complete relevant backend verification set**

```bash
cd QR_FOOD_ORDER_BE
npm run test:dining-profile-validation
npm run test:recommendation-engine
npm run test:recommendation-routes
npm run test:batch-fit-score
npm run test:food-attribute-entitlements
npm run test:insight-entitlements
npm run build
```

Expected: every command exits 0.

- [ ] **Step 2: Run the complete relevant frontend verification set**

```bash
cd QR_FOOD_ORDER_FE
npm run test:dining-profile-storage
npm run test:dining-profile-ui
npm run test:recommendation-client
npm run test:fit-score-client
npm run test:e2e:fit-score
npm run test:e2e:recommendation
npm run check:encoding
npm run build
```

Expected: every command exits 0.

- [ ] **Step 3: Run security and scope audits**

```bash
rg -n "UserDiningProfile|findOne.*userId" QR_FOOD_ORDER_BE/src/routes/recommendationRoutes.ts
rg -n "qdish_guest_user_id|/api/users/profile/|userId" QR_FOOD_ORDER_FE/src/pages/CustomerMenu.tsx QR_FOOD_ORDER_FE/src/components/dining/DiningOnboarding.tsx
git -C QR_FOOD_ORDER_BE diff origin/Thang_AI --check
git -C QR_FOOD_ORDER_FE diff origin/Thang_AI --check
git -C QR_FOOD_ORDER_BE status --short --branch
git -C QR_FOOD_ORDER_FE status --short --branch
```

Expected: the first two searches return no matches; diff checks are clean; status shows only intentional commits/files.

- [ ] **Step 4: Review the complete changes before push**

Run:

```bash
git -C QR_FOOD_ORDER_BE log --oneline origin/Thang_AI..HEAD
git -C QR_FOOD_ORDER_FE log --oneline origin/Thang_AI..HEAD
git -C QR_FOOD_ORDER_BE diff --stat origin/Thang_AI...HEAD
git -C QR_FOOD_ORDER_FE diff --stat origin/Thang_AI...HEAD
```

Expected: commits are limited to the approved local-first Recommendation profile scope. Push only after code review and user authorization already present for branch `Thang_AI`; never merge to `main`.
