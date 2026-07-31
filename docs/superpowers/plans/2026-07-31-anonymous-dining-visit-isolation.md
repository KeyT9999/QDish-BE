# Anonymous Dining Visit Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace global `UserDiningProfile` aggregation with restaurant-scoped anonymous dining visits so Merchant Insights cannot mix customer-segment data across tenants.

**Architecture:** Keep the existing device-local dining profile and recommendation flow for backward compatibility, but introduce a separate `AnonymousDiningVisit` analytics record keyed by restaurant, table session, and a session-scoped browser token. A small service validates and upserts public submissions; Merchant Insights aggregates only restaurant-scoped visit snapshots and never reads global profiles.

**Tech Stack:** Express 4, TypeScript 5.6, Mongoose 8, Node `assert`, React 19, TypeScript 6, Vite 8, browser `crypto.randomUUID()` and `sessionStorage`.

## Global Constraints

- A dining visit represents an anonymous survey response, not a unique human.
- Every analytics record must contain a valid `restaurantId` and a table session belonging to that restaurant.
- Accept only table sessions in `OPEN` or `PAYMENT_REQUESTED` state.
- Use a unique `{ restaurantId, tableSessionId, visitToken }` index and upsert semantics.
- Do not copy allergy data into analytics records.
- Do not backfill legacy `UserDiningProfile` records.
- Keep the legacy profile flow operational for Recommendation Engine compatibility.
- Remove simulated customer-segment fallback data; empty analytics must report real zero values.
- Do not add new runtime dependencies.

---

## File Structure

### Backend repository: `QR_FOOD_ORDER_BE`

- Create `src/models/AnonymousDiningVisit.ts` — schema, interface, indexes, allowed source enum.
- Create `src/services/anonymousDiningVisitService.ts` — boundary validation, session ownership/status check, idempotent upsert.
- Create `src/routes/anonymousDiningVisitRoutes.ts` — thin public HTTP adapter.
- Create `src/tests/anonymousDiningVisitService.test.ts` — dependency-injected service regression tests.
- Create `src/tests/merchantInsightIsolation.test.ts` — restaurant query and segment aggregation regression tests.
- Modify `src/services/merchantInsightService.ts` — query anonymous visits instead of global profiles.
- Modify `src/index.ts` — mount the new restaurant sub-resource route.
- Modify `package.json` — expose focused test commands.

### Frontend repository: `QR_FOOD_ORDER_FE`

- Create `src/services/diningVisitService.ts` — visit-token lifecycle and analytics POST contract.
- Modify `src/components/dining/DiningOnboarding.tsx` — submit the analytics snapshot without blocking local onboarding.
- Modify `src/pages/CustomerMenu.tsx` — provide restaurant and resolved table-session context.
- Modify `src/components/dashboard/restaurant/MerchantInsightsTab.tsx` — use “lượt khảo sát” language and zero-data state.

---

### Task 1: Add the tenant-scoped analytics model and recording service

**Files:**
- Create: `QR_FOOD_ORDER_BE/src/models/AnonymousDiningVisit.ts`
- Create: `QR_FOOD_ORDER_BE/src/services/anonymousDiningVisitService.ts`
- Create: `QR_FOOD_ORDER_BE/src/tests/anonymousDiningVisitService.test.ts`
- Modify: `QR_FOOD_ORDER_BE/package.json`

**Interfaces:**
- Consumes: `TableSession`, `TableSessionStatus`, Mongoose ObjectIds.
- Produces: `recordAnonymousDiningVisit(input, deps?)`, `AnonymousDiningVisitServiceError`, `RecordAnonymousDiningVisitInput`, and the `AnonymousDiningVisit` model.

- [ ] **Step 1: Write failing service tests with in-memory dependencies**

Create tests covering creation, idempotent update, multiple tokens, cross-tenant session rejection, closed-session rejection, invalid UUID, and enum rejection. Use the existing project test style:

```ts
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { TableSessionStatus } from "../models/TableSession.js";
import {
  AnonymousDiningVisitServiceError,
  recordAnonymousDiningVisit
} from "../services/anonymousDiningVisitService.js";

const restaurantA = new mongoose.Types.ObjectId();
const restaurantB = new mongoose.Types.ObjectId();
const sessionId = new mongoose.Types.ObjectId();

async function testRejectsCrossTenantSession() {
  const deps = {
    findTableSession: async () => ({
      _id: sessionId,
      restaurantId: restaurantB,
      status: TableSessionStatus.OPEN
    }),
    upsertVisit: async () => {
      throw new Error("must not write a cross-tenant visit");
    }
  };

  await assert.rejects(
    recordAnonymousDiningVisit({
      restaurantId: restaurantA.toString(),
      tableSessionId: sessionId.toString(),
      visitToken: "5b9c6d8e-8ac1-4fc7-a11d-889e603fa888",
      goals: ["BALANCED"],
      dietaryPreferences: []
    }, deps),
    (error: unknown) => error instanceof AnonymousDiningVisitServiceError && error.statusCode === 404
  );
}
```

- [ ] **Step 2: Add and run the focused test command to prove RED**

Add:

```json
"test:anonymous-dining": "tsx src/tests/anonymousDiningVisitService.test.ts"
```

Run: `npm run test:anonymous-dining`

Expected: FAIL because `anonymousDiningVisitService.ts` does not exist.

- [ ] **Step 3: Implement the Mongoose model**

Use this contract:

```ts
export enum AnonymousDiningVisitSource {
  ONBOARDING = "ONBOARDING"
}

export interface IAnonymousDiningVisit extends Document {
  restaurantId: Types.ObjectId;
  tableSessionId: Types.ObjectId;
  visitToken: string;
  goalsSnapshot: string[];
  dietaryPreferencesSnapshot: string[];
  source: AnonymousDiningVisitSource;
  recordedAt: Date;
}

AnonymousDiningVisitSchema.index(
  { restaurantId: 1, tableSessionId: 1, visitToken: 1 },
  { unique: true }
);
AnonymousDiningVisitSchema.index({ restaurantId: 1, recordedAt: -1 });
```

- [ ] **Step 4: Implement the recording service with explicit dependencies**

Use exact allowlists already exposed by onboarding:

```ts
const ALLOWED_GOALS = new Set([
  "MUSCLE_GAIN", "ENERGY_BOOST", "LIGHT_MEAL",
  "COMFORT", "BALANCED", "WEIGHT_LOSS"
]);
const ALLOWED_PREFERENCES = new Set([
  "VEGETARIAN", "VEGAN", "LOW_CARB",
  "HIGH_PROTEIN", "KETO", "SUGAR_FREE"
]);
```

The public function must have this signature:

```ts
export async function recordAnonymousDiningVisit(
  input: RecordAnonymousDiningVisitInput,
  deps: AnonymousDiningVisitDependencies = defaultDependencies
): Promise<{ id: string; recordedAt: Date; created: boolean }>
```

Validate ObjectIds, UUID using `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`, arrays with maximum 10 entries, deduplicate values, and verify session tenant and active status. The default `upsertVisit` dependency must call `AnonymousDiningVisit.updateOne(filter, update, { upsert: true })`, then read the record with `findOne(filter)`. Return `created: updateResult.upsertedCount === 1`; the unique index resolves concurrent inserts without relying on undocumented Mongoose result metadata.

- [ ] **Step 5: Run focused tests and backend build**

Run:

```powershell
npm run test:anonymous-dining
npm run build
```

Expected: tests print `anonymous dining visit service tests passed`; TypeScript exits 0.

- [ ] **Step 6: Commit backend task 1**

```powershell
git add package.json src/models/AnonymousDiningVisit.ts src/services/anonymousDiningVisitService.ts src/tests/anonymousDiningVisitService.test.ts
git commit -m "Add tenant-scoped anonymous dining visits"
```

---

### Task 2: Expose the public dining-visit endpoint safely

**Files:**
- Create: `QR_FOOD_ORDER_BE/src/routes/anonymousDiningVisitRoutes.ts`
- Modify: `QR_FOOD_ORDER_BE/src/index.ts`
- Modify: `QR_FOOD_ORDER_BE/src/tests/anonymousDiningVisitService.test.ts`

**Interfaces:**
- Consumes: `recordAnonymousDiningVisit(input)` from Task 1.
- Produces: `POST /api/restaurants/:restaurantId/dining-visits` returning `{ id, recordedAt, created }`.

- [ ] **Step 1: Extend tests for stable error semantics**

Add assertions that `AnonymousDiningVisitServiceError` exposes these mappings:

```ts
assert.equal(invalidInput.statusCode, 400);
assert.equal(invalidInput.code, "INVALID_DINING_VISIT");
assert.equal(missingOrCrossTenantSession.statusCode, 404);
assert.equal(missingOrCrossTenantSession.code, "TABLE_SESSION_NOT_FOUND");
assert.equal(closedSession.statusCode, 409);
assert.equal(closedSession.code, "TABLE_SESSION_INACTIVE");
```

- [ ] **Step 2: Run the focused test to confirm missing behavior fails**

Run: `npm run test:anonymous-dining`

Expected: FAIL on the first missing `code` or status mapping.

- [ ] **Step 3: Complete structured service errors and implement the route**

The route remains an adapter:

```ts
router.post("/:restaurantId/dining-visits", async (req, res) => {
  try {
    const result = await recordAnonymousDiningVisit({
      restaurantId: req.params.restaurantId,
      tableSessionId: req.body?.tableSessionId,
      visitToken: req.body?.visitToken,
      goals: req.body?.goals,
      dietaryPreferences: req.body?.dietaryPreferences
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    if (error instanceof AnonymousDiningVisitServiceError) {
      return res.status(error.statusCode).json({
        error: { code: error.code, message: error.message }
      });
    }
    console.error("Failed to record anonymous dining visit", error);
    return res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Không thể ghi nhận lượt khảo sát" }
    });
  }
});
```

Mount with `app.use("/api/restaurants", anonymousDiningVisitRoutes)` next to existing restaurant insight routes.

- [ ] **Step 4: Run tests and backend build**

Run:

```powershell
npm run test:anonymous-dining
npm run build
```

Expected: both exit 0.

- [ ] **Step 5: Commit backend task 2**

```powershell
git add src/index.ts src/routes/anonymousDiningVisitRoutes.ts src/services/anonymousDiningVisitService.ts src/tests/anonymousDiningVisitService.test.ts
git commit -m "Expose anonymous dining visit endpoint"
```

---

### Task 3: Isolate Merchant Insights by restaurant

**Files:**
- Modify: `QR_FOOD_ORDER_BE/src/services/merchantInsightService.ts`
- Create: `QR_FOOD_ORDER_BE/src/tests/merchantInsightIsolation.test.ts`
- Modify: `QR_FOOD_ORDER_BE/package.json`

**Interfaces:**
- Consumes: restaurant-scoped `AnonymousDiningVisit` documents from Task 1.
- Produces: the existing `MerchantInsights.customerSegments` response shape, now representing survey selections.

- [ ] **Step 1: Write failing isolation and aggregation tests**

Extract and test these explicit helpers:

```ts
export function buildDiningVisitQuery(
  restaurantId: string,
  start?: Date,
  end?: Date
): Record<string, unknown>;

export function aggregateCustomerSegments(
  visits: Array<{ goalsSnapshot?: string[] }>
): MerchantInsights["customerSegments"];
```

Assertions must prove:

```ts
const query = buildDiningVisitQuery(restaurantA.toString(), start, end);
assert.equal(query.restaurantId.toString(), restaurantA.toString());
assert.deepEqual(query.recordedAt, { $gte: start, $lte: end });

const segments = aggregateCustomerSegments([
  { goalsSnapshot: ["BALANCED", "LIGHT_MEAL"] },
  { goalsSnapshot: ["BALANCED"] }
]);
assert.equal(segments.find((x) => x.segment === "BALANCED")?.count, 2);
assert.equal(segments.find((x) => x.segment === "LIGHT_MEAL")?.count, 1);
```

Also assert an empty visit list returns all supported segments with count `0`, not simulated counts.

- [ ] **Step 2: Add the test script and prove RED**

Add:

```json
"test:merchant-insight-isolation": "tsx src/tests/merchantInsightIsolation.test.ts"
```

Run: `npm run test:merchant-insight-isolation`

Expected: FAIL because the helper exports do not exist.

- [ ] **Step 3: Replace the global profile query**

Remove the `UserDiningProfile` import and this behavior:

```ts
UserDiningProfile.find(profileQuery).limit(200)
```

Query instead:

```ts
const recentVisits = await AnonymousDiningVisit.find(
  buildDiningVisitQuery(restaurantId, start, end)
).select("goalsSnapshot").lean();
const customerSegments = aggregateCustomerSegments(recentVisits);
```

Delete the `totalScans < 3` simulated segment mutations. Do not alter the existing response field name in this change.

- [ ] **Step 4: Run isolation tests, existing AI tests, and backend build**

Run:

```powershell
npm run test:merchant-insight-isolation
npm run test:anonymous-dining
npx tsx src/tests/attributeEngine.test.ts
npx tsx src/tests/fitScoreEngine.test.ts
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit backend task 3**

```powershell
git add package.json src/services/merchantInsightService.ts src/tests/merchantInsightIsolation.test.ts
git commit -m "Scope merchant insights to restaurant visits"
```

---

### Task 4: Submit one anonymous visit snapshot per browser table session

**Files:**
- Create: `QR_FOOD_ORDER_FE/src/services/diningVisitService.ts`
- Modify: `QR_FOOD_ORDER_FE/src/components/dining/DiningOnboarding.tsx`
- Modify: `QR_FOOD_ORDER_FE/src/pages/CustomerMenu.tsx`

**Interfaces:**
- Consumes: `restaurantId`, resolved `tableSessionId`, onboarding goals/preferences.
- Produces: stable session-scoped visit token and POST request matching Task 2.

- [ ] **Step 1: Create the typed frontend service contract**

Implement:

```ts
export interface RecordDiningVisitInput {
  restaurantId: string;
  tableSessionId: string;
  visitToken: string;
  goals: string[];
  dietaryPreferences: string[];
}

export function getOrCreateDiningVisitToken(
  restaurantId: string,
  tableSessionId: string
): string {
  const key = `qdish_visit:${restaurantId}:${tableSessionId}`;
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const token = crypto.randomUUID();
  sessionStorage.setItem(key, token);
  return token;
}

export async function recordDiningVisit(input: RecordDiningVisitInput) {
  return apiFetch<{ id: string; recordedAt: string; created: boolean }>(
    `/api/restaurants/${input.restaurantId}/dining-visits`,
    {
      method: "POST",
      body: JSON.stringify({
        tableSessionId: input.tableSessionId,
        visitToken: input.visitToken,
        goals: input.goals,
        dietaryPreferences: input.dietaryPreferences
      })
    }
  );
}
```

- [ ] **Step 2: Extend onboarding props and keep analytics non-blocking**

Add exact optional context:

```ts
interface DiningOnboardingProps {
  open: boolean;
  onClose: () => void;
  onComplete: (profile: DiningProfile) => void;
  userId: string;
  restaurantId: string;
  tableSessionId?: string;
}
```

After the existing profile request and `onComplete(profileData)`, record analytics only when `tableSessionId` exists. Catch that request separately so failure does not enter the broader onboarding fallback:

```ts
if (tableSessionId) {
  try {
    await recordDiningVisit({
      restaurantId,
      tableSessionId,
      visitToken: getOrCreateDiningVisitToken(restaurantId, tableSessionId),
      goals,
      dietaryPreferences: preferences
    });
  } catch (error) {
    console.error("Failed to record anonymous dining visit", error);
  }
}
```

- [ ] **Step 3: Pass resolved context from CustomerMenu**

Update the component call:

```tsx
<DiningOnboarding
  open={isOnboardingOpen}
  onClose={() => setIsOnboardingOpen(false)}
  onComplete={saveProfile}
  userId={guestUserId}
  restaurantId={restaurantId}
  tableSessionId={sessionId || undefined}
/>
```

- [ ] **Step 4: Run frontend encoding check and build**

Run:

```powershell
npm run check:encoding
npm run build
```

Expected: both exit 0; TypeScript confirms prop and API contracts.

- [ ] **Step 5: Commit frontend task 4**

```powershell
git add src/services/diningVisitService.ts src/components/dining/DiningOnboarding.tsx src/pages/CustomerMenu.tsx
git commit -m "Record restaurant-scoped dining visits"
```

---

### Task 5: Align Merchant Insights copy with anonymous survey semantics

**Files:**
- Modify: `QR_FOOD_ORDER_FE/src/components/dashboard/restaurant/MerchantInsightsTab.tsx`

**Interfaces:**
- Consumes: unchanged `MerchantInsights.customerSegments` response shape.
- Produces: honest copy that describes survey responses and no longer implies unique people.

- [ ] **Step 1: Replace identity claims with survey terminology**

Update visible strings as follows:

```text
"Thị hiếu của Thực khách quét QR" -> "Xu hướng từ lượt khảo sát QR"
"khách hàng" when backed by customerSegments -> "lượt khảo sát"
"lượt tìm kiếm" when backed by goal counts -> "lượt lựa chọn"
"Quét QR: X/20" -> "Lượt khảo sát: X/20"
```

Keep order-based labels such as “đơn đặt món” unchanged.

- [ ] **Step 2: Ensure the empty state shows real zero data**

The existing threshold branch must render `0/20` when there are no visits and must not display fabricated segment totals. Do not introduce fallback client values.

- [ ] **Step 3: Run frontend checks**

Run:

```powershell
npm run check:encoding
npm run lint
npm run build
```

Expected: all commands exit 0. If lint reports pre-existing unrelated failures, record the exact files and confirm no new lint errors in touched files with `npx eslint src/components/dashboard/restaurant/MerchantInsightsTab.tsx src/components/dining/DiningOnboarding.tsx src/pages/CustomerMenu.tsx src/services/diningVisitService.ts`.

- [ ] **Step 4: Commit frontend task 5**

```powershell
git add src/components/dashboard/restaurant/MerchantInsightsTab.tsx
git commit -m "Clarify anonymous survey insight labels"
```

---

### Task 6: Final cross-repository verification

**Files:**
- Verify only; modify a file only to fix a failure caused by Tasks 1–5.

**Interfaces:**
- Consumes: all backend and frontend deliverables.
- Produces: evidence that tenant isolation, idempotency, compatibility, and builds pass.

- [ ] **Step 1: Verify backend**

Run from `QR_FOOD_ORDER_BE`:

```powershell
npm run test:anonymous-dining
npm run test:merchant-insight-isolation
npx tsx src/tests/attributeEngine.test.ts
npx tsx src/tests/fitScoreEngine.test.ts
npm run build
git status --short
```

Expected: all tests/build pass and no unintended files are present.

- [ ] **Step 2: Verify frontend**

Run from `QR_FOOD_ORDER_FE`:

```powershell
npm run check:encoding
npm run lint
npm run build
git status --short
```

Expected: encoding/build pass; lint passes or only documented unrelated baseline failures remain.

- [ ] **Step 3: Perform static isolation checks**

Run from the workspace root:

```powershell
rg -n "UserDiningProfile" QR_FOOD_ORDER_BE/src/services/merchantInsightService.ts
rg -n "AnonymousDiningVisit|restaurantId" QR_FOOD_ORDER_BE/src/services/merchantInsightService.ts QR_FOOD_ORDER_BE/src/services/anonymousDiningVisitService.ts
rg -n "segmentsMap\[\"MUSCLE_GAIN\"\] \+=|Simulated data" QR_FOOD_ORDER_BE/src/services/merchantInsightService.ts
```

Expected: first and third searches return no matches; second shows restaurant-scoped reads and writes.

- [ ] **Step 4: Review both repository diffs and commit any verification-only fixes separately**

Use `git diff --check` and `git log --oneline -6` in each repository. Do not combine backend and frontend paths in one Git command because they are separate repositories.
