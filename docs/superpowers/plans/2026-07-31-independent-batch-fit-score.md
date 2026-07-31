# Independent Batch Fit Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give anonymous diners one personalized Fit Score on every ordinary menu card and dish detail through one tenant-scoped batch request.

**Architecture:** Add a plan-gated batch endpoint that loads menu items and nutrition profiles in two bounded queries, reuses `FitScoreEngine`, and returns a typed score map. The frontend requests the map once when an eligible local dining profile exists, then passes one canonical score object to cards, details, and recommendation UI.

**Tech Stack:** Express, TypeScript, Mongoose, React 19, Vite, Node built-in assertions, existing `tsx` and `node --experimental-strip-types` test runners.

## Global Constraints

- Fit Score authorization checks only `plan.fitScoreEnabled === true`; it must not depend on `recommendationEnabled`.
- Do not request or render Fit Score until the anonymous profile has at least one goal or preference.
- Keep the existing `GET/POST /api/dishes/:dishId/fit-score` endpoints.
- Load menu items and nutrition profiles in batches; do not query once per dish.
- Return scores only for available dishes owned by the requested restaurant.
- Do not persist Fit Score responses or create a logged-in customer identity.
- Do not add new runtime or test dependencies.
- A Fit Score failure must not block menu browsing or ordering.

---

## File Structure

### Backend (`QR_FOOD_ORDER_BE`)

- Create `src/services/batchFitScoreService.ts`: batch query orchestration, score summaries, deterministic explanations.
- Create `src/tests/batchFitScoreService.test.ts`: primary context, tenant scope, allergen block, query-count behavior.
- Modify `src/engines/fitScore/FitScoreEngine.ts`: expose canonical primary-context resolution reused by Recommendation.
- Modify `src/engines/recommendation/RecommendationEngine.ts`: replace its local goal mapping with the canonical helper.
- Modify `src/routes/fitScoreRoutes.ts`: add validated, plan-gated `POST /fit-scores` before per-dish routes.
- Modify `src/tests/fitScoreEngine.test.ts`: regression coverage for primary context mapping.
- Modify `package.json`: add `test:batch-fit-score`.

### Frontend (`QR_FOOD_ORDER_FE`)

- Create `src/services/fitScoreService.ts`: request/response types and injectable batch loader.
- Create `src/services/fitScorePresentation.ts`: profile eligibility and badge presentation helpers.
- Create `tests/fitScoreClient.test.ts`: no-request gates, endpoint contract, response map, presentation states.
- Create `src/components/menu/FitScoreBadge.tsx`: compact card/recommendation score state.
- Create `src/components/menu/FitScorePanel.tsx`: detailed score and allergen state.
- Modify `src/components/menu/MenuItemCard.tsx`: accept and render an optional score summary.
- Modify `src/components/menu/MenuItemDetail.tsx`: accept summary and profile-edit callback.
- Modify `src/pages/CustomerMenu.tsx`: one batch request and score-map propagation.
- Modify `package.json`: add `test:fit-score-client`.

---

### Task 1: Canonical Fit Score Context Selection

**Files:**
- Modify: `QR_FOOD_ORDER_BE/src/engines/fitScore/FitScoreEngine.ts`
- Modify: `QR_FOOD_ORDER_BE/src/engines/recommendation/RecommendationEngine.ts`
- Modify: `QR_FOOD_ORDER_BE/src/tests/fitScoreEngine.test.ts`

**Interfaces:**
- Consumes: existing `UserDiningProfile` and `FitScoreMap` from `FitScoreEngine.ts`.
- Produces: `FitScoreEngine.resolvePrimaryScoreType(profile?: UserDiningProfile): string | undefined`.

- [ ] **Step 1: Add failing primary-context tests**

Append assertions covering the exact mapping:

```ts
assert.equal(FitScoreEngine.resolvePrimaryScoreType({
  goals: ["MUSCLE_GAIN"], allergies: [], preferences: []
}), "gym_fit");
assert.equal(FitScoreEngine.resolvePrimaryScoreType({
  goals: ["WEIGHT_LOSS"], allergies: [], preferences: []
}), "quick_lunch_fit");
assert.equal(FitScoreEngine.resolvePrimaryScoreType({
  goals: ["ENERGY_BOOST"], allergies: [], preferences: []
}), "energy_boost_fit");
assert.equal(FitScoreEngine.resolvePrimaryScoreType({
  goals: ["COMFORT"], allergies: [], preferences: []
}), "late_night_fit");
assert.equal(FitScoreEngine.resolvePrimaryScoreType({
  goals: ["BALANCED"], allergies: [], preferences: []
}), "office_lunch_fit");
assert.equal(FitScoreEngine.resolvePrimaryScoreType({
  goals: [], allergies: [], preferences: ["VEGAN"]
}), undefined);
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npx tsx src/tests/fitScoreEngine.test.ts`

Expected: FAIL because `resolvePrimaryScoreType` does not exist.

- [ ] **Step 3: Implement the canonical helper**

Add to `FitScoreEngine`:

```ts
public static resolvePrimaryScoreType(profile?: UserDiningProfile): string | undefined {
  const goals = profile?.goals ?? [];
  if (goals.includes("MUSCLE_GAIN")) return "gym_fit";
  if (goals.includes("WEIGHT_LOSS") || goals.includes("LIGHT_MEAL")) return "quick_lunch_fit";
  if (goals.includes("ENERGY_BOOST")) return "energy_boost_fit";
  if (goals.includes("COMFORT")) return "late_night_fit";
  if (goals.includes("BALANCED")) return "office_lunch_fit";
  return undefined;
}
```

Replace Recommendation Engine's local `primaryGoalType` branch with:

```ts
const primaryGoalType =
  FitScoreEngine.resolvePrimaryScoreType(userProfile) ?? "office_lunch_fit";
```

- [ ] **Step 4: Verify GREEN and existing recommendation behavior**

Run:

```powershell
npx tsx src/tests/fitScoreEngine.test.ts
npm run build
```

Expected: all commands exit 0.

`src/tests/recommendation.test.ts` is a database-dependent smoke test rather than a deterministic unit test. Run it only when a seeded local MongoDB instance is available; it is not a completion gate for this task.

- [ ] **Step 5: Commit**

```powershell
git add src/engines/fitScore/FitScoreEngine.ts src/engines/recommendation/RecommendationEngine.ts src/tests/fitScoreEngine.test.ts
git commit -m "Centralize Fit Score context selection"
```

### Task 2: Tenant-Scoped Batch Fit Score Service

**Files:**
- Create: `QR_FOOD_ORDER_BE/src/services/batchFitScoreService.ts`
- Create: `QR_FOOD_ORDER_BE/src/tests/batchFitScoreService.test.ts`
- Modify: `QR_FOOD_ORDER_BE/package.json`

**Interfaces:**
- Consumes: `FitScoreEngine.calculateAllFitScores`, `resolvePrimaryScoreType`, `getBestFitContext`, `MenuItem`, and `DishNutritionProfile`.
- Produces:

```ts
export interface BatchFitScoreInput {
  restaurantId: string;
  userProfile: UserDiningProfile;
  context?: DiningContext;
}

export interface FitScoreSummary {
  score: number;
  label: string;
  contextType: string;
  reasons: string[];
  blocked: boolean;
  blockReason?: "allergen";
}

export type FitScoreMapResponse = Record<string, FitScoreSummary>;

export async function calculateBatchFitScores(
  input: BatchFitScoreInput,
  dependencies?: BatchFitScoreDependencies
): Promise<FitScoreMapResponse>;
```

- [ ] **Step 1: Write failing service tests with injected repositories**

Tests must use fakes that count calls and return dishes from two restaurants. Assert:

```ts
assert.equal(menuFindCalls, 1);
assert.equal(profileFindCalls, 1);
assert.deepEqual(Object.keys(scores), [restaurantADishId]);
assert.equal(scores[restaurantADishId].contextType, "gym_fit");
assert.equal(scores[restaurantADishId].blocked, false);
assert.ok(scores[restaurantADishId].reasons.length <= 3);
```

Add an allergen case:

```ts
assert.deepEqual(scores[soyDishId], {
  score: 0,
  label: "Có dị ứng",
  contextType: "allergen_block",
  reasons: ["Món có thành phần xung đột với dị ứng đã chọn"],
  blocked: true,
  blockReason: "allergen"
});
```

- [ ] **Step 2: Add the script and verify RED**

Add:

```json
"test:batch-fit-score": "tsx src/tests/batchFitScoreService.test.ts"
```

Run: `npm run test:batch-fit-score`

Expected: FAIL because `batchFitScoreService` does not exist.

- [ ] **Step 3: Implement batched data loading and summaries**

The implementation must query with tenant scope at the database boundary:

```ts
const restaurantObjectId = new mongoose.Types.ObjectId(input.restaurantId);
const dishes = await dependencies.findMenuItems({
  restaurantId: restaurantObjectId,
  available: true
});
const profiles = await dependencies.findNutritionProfiles({
  dishId: { $in: dishes.map((dish) => dish._id) },
  restaurantId: restaurantObjectId
});
```

For each dish:

```ts
const fitScores = FitScoreEngine.calculateAllFitScores(
  nutrition,
  attributes,
  input.userProfile,
  input.context
);
const requestedType = FitScoreEngine.resolvePrimaryScoreType(input.userProfile);
const best = FitScoreEngine.getBestFitContext(fitScores);
const contextType = requestedType ?? best.type;
const score = fitScores[contextType] ?? best.score;
```

Build labels with exact thresholds: `Rất phù hợp` for 80–100, `Phù hợp` for 60–79, and `Có thể cân nhắc` below 60. Build at most three deterministic reason strings from goal match, preference/attribute match, nutrition highlight, and time context.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm run test:batch-fit-score
npx tsx src/tests/fitScoreEngine.test.ts
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add package.json src/services/batchFitScoreService.ts src/tests/batchFitScoreService.test.ts
git commit -m "Add tenant-scoped batch Fit Scores"
```

### Task 3: Validated and Plan-Gated Batch Route

**Files:**
- Modify: `QR_FOOD_ORDER_BE/src/routes/fitScoreRoutes.ts`
- Modify: `QR_FOOD_ORDER_BE/src/tests/batchFitScoreService.test.ts`

**Interfaces:**
- Consumes: `calculateBatchFitScores(input)` from Task 2 and existing subscription helpers.
- Produces: `POST /api/dishes/fit-scores` with `{ scores: FitScoreMapResponse }`.

- [ ] **Step 1: Add failing route-handler tests**

Export an injectable `createBatchFitScoreHandler(dependencies)` and test with fake request/response objects. Cover:

```ts
// fitScoreEnabled false, recommendationEnabled true
assert.equal(response.statusCode, 403);
assert.equal(calculateCalls, 0);

// fitScoreEnabled true, recommendationEnabled false
assert.equal(response.statusCode, 200);
assert.deepEqual(response.body, { scores: expectedScores });
assert.equal(calculateCalls, 1);
```

Also assert `400` for an invalid ObjectId, more than 10 values in any profile array, unknown enum values, and invalid `timeOfDay`.

- [ ] **Step 2: Run focused test to verify RED**

Run: `npm run test:batch-fit-score`

Expected: FAIL because the handler export and route contract do not exist.

- [ ] **Step 3: Implement validation and entitlement**

Use allowlists matching existing frontend enums:

```ts
const ALLOWED_GOALS = new Set([
  "MUSCLE_GAIN", "ENERGY_BOOST", "LIGHT_MEAL", "COMFORT",
  "BALANCED", "WEIGHT_LOSS", "MAINTENANCE", "GENERAL_HEALTH"
]);
const ALLOWED_PREFERENCES = new Set([
  "VEGAN", "VEGETARIAN", "LOW_CARB", "HIGH_PROTEIN",
  "KETO", "GLUTEN_FREE", "LOW_FAT", "SUGAR_FREE"
]);
const ALLOWED_ALLERGIES = new Set([
  "GLUTEN", "DAIRY", "NUTS", "SHELLFISH", "SOY", "EGGS", "FISH"
]);
```

Reject invalid input with:

```ts
return res.status(400).json({
  error: { code: "INVALID_FIT_SCORE_REQUEST", message: "Yêu cầu Fit Score không hợp lệ" }
});
```

Resolve the owner and plan, then authorize only with:

```ts
if (!plan || plan.fitScoreEnabled !== true) {
  return res.status(403).json({
    error: { code: "FIT_SCORE_NOT_AVAILABLE", message: "Fit Score không khả dụng cho gói dịch vụ này" }
  });
}
```

Register `router.post("/fit-scores", createBatchFitScoreHandler())` before the existing `/:dishId/fit-score` handlers.

- [ ] **Step 4: Verify route and regressions**

Run:

```powershell
npm run test:batch-fit-score
npx tsx src/tests/fitScoreEngine.test.ts
npm run build
```

Expected: all commands exit 0.

Optionally run `npx tsx src/tests/recommendation.test.ts` against a seeded local MongoDB instance as an integration smoke test.

- [ ] **Step 5: Commit**

```powershell
git add src/routes/fitScoreRoutes.ts src/tests/batchFitScoreService.test.ts
git commit -m "Expose plan-gated batch Fit Scores"
```

### Task 4: Typed Frontend Fit Score Client

**Files:**
- Create: `QR_FOOD_ORDER_FE/src/services/fitScoreService.ts`
- Create: `QR_FOOD_ORDER_FE/src/services/fitScorePresentation.ts`
- Create: `QR_FOOD_ORDER_FE/tests/fitScoreClient.test.ts`
- Modify: `QR_FOOD_ORDER_FE/package.json`

**Interfaces:**
- Consumes: existing `apiFetch` and `DiningProfile`.
- Produces:

```ts
export interface FitScoreSummary {
  score: number;
  label: string;
  contextType: string;
  reasons: string[];
  blocked: boolean;
  blockReason?: "allergen";
}

export type FitScoreMap = Record<string, FitScoreSummary>;

export interface FitScoreTone {
  name: "blocked" | "high" | "medium" | "low";
  className: string;
}

export function hasFitScoreProfile(profile: DiningProfile): boolean;
export function getFitScoreTone(summary: FitScoreSummary): FitScoreTone;

export async function loadBatchFitScores(input: {
  restaurantId: string;
  profile: DiningProfile;
  context: { timeOfDay: "breakfast" | "lunch" | "dinner" | "late_night"; postWorkout: boolean };
  fetcher: typeof apiFetch;
}): Promise<FitScoreMap>;
```

- [ ] **Step 1: Write failing Node tests**

Test eligibility and the exact request body:

```ts
assert.equal(hasFitScoreProfile(emptyProfile), false);
assert.equal(hasFitScoreProfile({ ...emptyProfile, preferences: ["VEGAN"] }), true);

assert.equal(requests.length, 1);
assert.equal(requests[0].path, "/api/dishes/fit-scores");
assert.deepEqual(JSON.parse(requests[0].options.body as string), {
  restaurantId: "restaurant-1",
  userProfile: {
    goals: ["MUSCLE_GAIN"],
    preferences: ["HIGH_PROTEIN"],
    allergies: ["SOY"]
  },
  context: { timeOfDay: "lunch", postWorkout: true }
});
```

Test `getFitScoreTone`: blocked → red, 80+ → green, 60–79 → amber, below 60 → neutral.

- [ ] **Step 2: Add the script and verify RED**

Add:

```json
"test:fit-score-client": "node --experimental-strip-types tests/fitScoreClient.test.ts"
```

Run: `npm run test:fit-score-client`

Expected: FAIL because the two frontend modules do not exist.

- [ ] **Step 3: Implement the typed loader and presentation helpers**

`loadBatchFitScores` must call `apiFetch<{ scores: FitScoreMap }>` with `requireAuth: false`, return `response.scores`, and omit `conditions` from the API request because the backend contract does not consume them.

`hasFitScoreProfile` must be exactly:

```ts
return profile.goals.length > 0 || profile.preferences.length > 0;
```

`getFitScoreTone` must return these stable presentation states:

```ts
if (summary.blocked) return { name: "blocked", className: "bg-red-600 text-white" };
if (summary.score >= 80) return { name: "high", className: "bg-emerald-600 text-white" };
if (summary.score >= 60) return { name: "medium", className: "bg-amber-100 text-amber-800" };
return { name: "low", className: "bg-neutral-100 text-neutral-700" };
```

- [ ] **Step 4: Verify GREEN and frontend build**

Run:

```powershell
npm run test:fit-score-client
npm run check:encoding
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add package.json src/services/fitScoreService.ts src/services/fitScorePresentation.ts tests/fitScoreClient.test.ts
git commit -m "Add typed batch Fit Score client"
```

### Task 5: Card and Dish Detail Fit Score UI

**Files:**
- Create: `QR_FOOD_ORDER_FE/src/components/menu/FitScoreBadge.tsx`
- Create: `QR_FOOD_ORDER_FE/src/components/menu/FitScorePanel.tsx`
- Modify: `QR_FOOD_ORDER_FE/src/components/menu/MenuItemCard.tsx`
- Modify: `QR_FOOD_ORDER_FE/src/components/menu/MenuItemDetail.tsx`

**Interfaces:**
- Consumes: `FitScoreSummary` and `getFitScoreTone` from Task 4.
- Produces optional props:

```ts
fitScore?: FitScoreSummary;
isFitScoreLoading?: boolean;
onEditProfile?: () => void;
```

- [ ] **Step 1: Add compile-time component contracts**

Create components with explicit props:

```tsx
export function FitScoreBadge({
  summary,
  loading = false
}: {
  summary?: FitScoreSummary;
  loading?: boolean;
}) {
  if (loading) {
    return <span className="h-6 w-20 animate-pulse rounded-full bg-neutral-200" />;
  }
  if (!summary) return null;
  if (summary.blocked) {
    return <span className="rounded-full bg-red-600 px-2 py-1 text-[10px] font-bold text-white">Có dị ứng</span>;
  }
  const tone = getFitScoreTone(summary);
  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tone.className}`}>
      {summary.score}% phù hợp
    </span>
  );
}

export function FitScorePanel({
  summary,
  onEditProfile
}: {
  summary: FitScoreSummary;
  onEditProfile: () => void;
}) {
  if (summary.blocked) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-4">
        <h3 className="font-bold text-red-700">Có thành phần gây dị ứng</h3>
        <p className="mt-1 text-xs text-red-600">{summary.reasons[0]}</p>
        <button type="button" onClick={onEditProfile} className="mt-3 text-xs font-bold text-red-700">
          Cập nhật sở thích
        </button>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
      <div className="flex items-baseline gap-2">
        <strong className="text-2xl text-emerald-700">{summary.score}%</strong>
        <span className="text-xs font-bold text-emerald-800">{summary.label}</span>
      </div>
      <ul className="mt-3 space-y-1 text-xs text-neutral-600">
        {summary.reasons.slice(0, 3).map((reason) => <li key={reason}>• {reason}</li>)}
      </ul>
      <button type="button" onClick={onEditProfile} className="mt-3 text-xs font-bold text-emerald-700">
        Cập nhật sở thích
      </button>
    </section>
  );
}
```

- [ ] **Step 2: Render the badge on ordinary cards**

Add `fitScore` and `isFitScoreLoading` to `MenuItemCardProps`. Render `FitScoreBadge` over the image only when loading or a summary exists. Preserve the existing allergen styling and cart handlers.

- [ ] **Step 3: Render the detail panel**

Add `fitScore` and `onEditProfile` to `MenuItemDetailProps`. Place `FitScorePanel` before the nutrition section. Render at most `summary.reasons.slice(0, 3)` and call `onEditProfile` from the “Cập nhật sở thích” action.

- [ ] **Step 4: Run targeted lint and build**

Run:

```powershell
npx eslint src/components/menu/FitScoreBadge.tsx src/components/menu/FitScorePanel.tsx src/components/menu/MenuItemCard.tsx src/components/menu/MenuItemDetail.tsx
npm run build
```

Expected: exit 0 with no new errors. Existing warnings in previously modified files must be reported, not silently suppressed.

- [ ] **Step 5: Commit**

```powershell
git add src/components/menu/FitScoreBadge.tsx src/components/menu/FitScorePanel.tsx src/components/menu/MenuItemCard.tsx src/components/menu/MenuItemDetail.tsx
git commit -m "Show Fit Scores on menu items"
```

### Task 6: Customer Menu Batch Orchestration

**Files:**
- Modify: `QR_FOOD_ORDER_FE/src/pages/CustomerMenu.tsx`
- Modify: `QR_FOOD_ORDER_FE/tests/fitScoreClient.test.ts`

**Interfaces:**
- Consumes: Task 4 loader and Task 5 component props.
- Produces: one in-memory `FitScoreMap` used by all Fit Score UI surfaces.

- [ ] **Step 1: Add failing orchestration-helper tests**

Extend `fitScorePresentation.ts` with a pure request gate:

```ts
export function shouldLoadFitScores(input: {
  fitScoreEnabled?: boolean;
  restaurantId?: string;
  profile: DiningProfile;
}): boolean;
```

Assert false for a disabled flag, missing restaurant, and empty profile; assert true only when all conditions pass.

- [ ] **Step 2: Verify RED**

Run: `npm run test:fit-score-client`

Expected: FAIL because `shouldLoadFitScores` does not exist.

- [ ] **Step 3: Implement the request gate and CustomerMenu effect**

Add state:

```ts
const [fitScores, setFitScores] = useState<FitScoreMap>({});
const [isFitScoreLoading, setIsFitScoreLoading] = useState(false);
```

The effect must:

1. Clear the map and return when the request gate is false.
2. Derive one time bucket from the current hour.
3. Call `loadBatchFitScores` once.
4. Ignore stale responses with an `isMounted` guard.
5. On failure, log one concise error, clear the map, and leave menu/cart state untouched.

- [ ] **Step 4: Propagate one canonical score**

For each ordinary card and the selected detail, derive the key with `item.id || item._id` and pass `fitScores[key]`.

In the Recommendation carousel, render `fitScores[itemId]?.score` when present. Do not render `rec.fitScore` as a competing visible source after the batch result is available. Recommendation may continue using its own score internally for ranking.

Implement detail profile editing as:

```ts
onEditProfile={() => {
  setIsDetailOpen(false);
  setIsHealthOpen(true);
}}
```

- [ ] **Step 5: Verify frontend behavior mechanically**

Run:

```powershell
npm run test:fit-score-client
npm run test:merchant-insight-access
npm run test:dining-visit-token
npm run check:encoding
npx eslint src/services/fitScoreService.ts src/services/fitScorePresentation.ts src/components/menu/FitScoreBadge.tsx src/components/menu/FitScorePanel.tsx src/components/menu/MenuItemCard.tsx src/components/menu/MenuItemDetail.tsx src/pages/CustomerMenu.tsx
npm run build
```

Expected: tests and build exit 0; no new ESLint errors.

- [ ] **Step 6: Commit**

```powershell
git add src/pages/CustomerMenu.tsx src/services/fitScorePresentation.ts tests/fitScoreClient.test.ts
git commit -m "Load one Fit Score batch per menu"
```

### Task 7: Final Security, Regression, and Branch Verification

**Files:**
- Review only: all files changed in Tasks 1–6.

**Interfaces:**
- Consumes: completed Backend and Frontend feature.
- Produces: verified, clean `Thang_AI` branches ready to push.

- [ ] **Step 1: Run Backend verification**

```powershell
npm run test:batch-fit-score
npm run test:food-attribute-entitlements
npm run test:insight-entitlements
npm run test:merchant-insight-isolation
npm run test:anonymous-dining
npm run test:table-session
npx tsx src/tests/attributeEngine.test.ts
npx tsx src/tests/fitScoreEngine.test.ts
npm run build
```

Expected: every command exits 0.

If a seeded local MongoDB instance is available, also run `npx tsx src/tests/recommendation.test.ts` as a non-blocking integration smoke test and record its result separately.

- [ ] **Step 2: Run Frontend verification**

```powershell
npm run test:fit-score-client
npm run test:merchant-insight-access
npm run test:dining-visit-token
npm run check:encoding
npm run build
```

Expected: every command exits 0.

- [ ] **Step 3: Review authorization and data boundaries**

Confirm statically and in tests:

- Batch route checks `fitScoreEnabled === true` server-side.
- Route never checks `recommendationEnabled`.
- Both menu and nutrition profile queries include the same restaurant boundary.
- Request arrays are capped and allowlisted.
- Error responses contain no stack traces or raw database errors.
- No new secrets, dependencies, or lockfile changes exist.

- [ ] **Step 4: Review Git state and push only after clean verification**

```powershell
git diff --check
git status --short
git log --oneline origin/Thang_AI..HEAD
```

Expected: no uncommitted files and only the planned commits ahead of `origin/Thang_AI`.

Push each repository without merging:

```powershell
git push origin Thang_AI
```
