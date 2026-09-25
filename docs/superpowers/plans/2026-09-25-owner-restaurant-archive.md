# Owner Restaurant Archive Implementation Plan
> For agentic workers: execute task-by-task, test-first, and verify each task before moving on.

**Goal:** Add reversible owner-only restaurant archiving that preserves all data, stops archived branches from accepting orders, frees only branch quota, and provides restore UX.

**Architecture:** Use a nullable `Restaurant.archivedAt` marker and owner actor field, scoped archive/restore APIs, existing lifecycle status sets for blockers, a restaurant-quota-only usage change, and explicit archive guards at public ordering and branch authentication boundaries. Keep archived history and branch resources intact. FE uses a separate archived view and the owner APIs.

**Tech Stack:** Express + TypeScript + Mongoose, React + TypeScript + Vite, Node test runner scripts, npm CI workflows.

## Global Constraints

- This is reversible archiving, not deletion. Orders, bills, tables, menu items, staff accounts, ingredients, customer records, and other linked documents remain untouched.
- `archivedAt` missing or null means active; a date means archived. Preserve `status` and `active` values across archive/restore.
- Only the owning authenticated `RESTAURANT_OWNER` may archive or restore. Scope every write and lookup by `ownerId`; wrong-owner IDs return 404.
- Archive is `DELETE /api/owner/restaurants/:restaurantId`; restore is `POST /api/owner/restaurants/:restaurantId/restore`.
- Owner list defaults to active branches; `GET /api/owner/restaurants?archived=true` returns only archived branches.
- Archive is blocked with HTTP 409/code `RESTAURANT_HAS_OPEN_ACTIVITY` while session statuses `OPEN`/`PAYMENT_REQUESTED` or bill statuses `UNPAID`/`PAYMENT_REQUESTED` exist. Return `activeSessions` and `unpaidBills` counts.
- Restaurant quota counts only non-archived branches. Archived branch tables/menu/staff continue to count toward their own separate quotas.
- Archived branches must be blocked from public restaurant lookup, customer order/session creation, and existing branch admin/staff JWTs. Owners can list archived branches and restore them.
- Do not change subscription state, user active flags, or cascade/delete linked documents. Leave the existing super-admin hard-delete API unchanged.
- Do not push or create a PR in this task. The user asked to implement on a new local branch; hosted CI must be reported as unverified until a later authorized push.

---

### Task 1 — Complete: Add archive metadata, owner API, and branch quota semantics

**Files:**
- Modify: `QR_FOOD_ORDER_BE/src/models/Restaurant.ts`
- Modify: `QR_FOOD_ORDER_BE/src/routes/ownerRestaurantRoutes.ts`
- Modify: `QR_FOOD_ORDER_BE/src/services/subscriptionService.ts`
- Add: `QR_FOOD_ORDER_BE/src/services/restaurantArchiveService.ts` (only if needed to keep archive/restore policy independently testable)
- Add: `QR_FOOD_ORDER_BE/src/tests/restaurantArchive.test.ts`
- Modify: `QR_FOOD_ORDER_BE/package.json` (`test:restaurant-archive`, include it in `test:ci`)

**Implementation:**
1. Write failing tests for owner-scoped archive, repeat archive idempotency, active session and active bill conflicts, successful restore, quota rejection, and unchanged branch status/data.
2. Add `archivedAt` and `archivedByOwnerId` with legacy documents treated as active.
3. Add `DELETE /:restaurantId` and `POST /:restaurantId/restore`, with ownership checks, lifecycle blockers, stable error codes, and no linked-record writes/deletes. Make the archive marker conditional/owner-scoped and make error paths leave the branch in a consistent state.
4. Filter `GET /` to active by default and archived only when `archived=true`.
5. Count only non-archived restaurants for `RESTAURANT_LIMIT`, while retaining all owner restaurant IDs for table/menu/staff/scan usage.

**Verification:** `npm run test:restaurant-archive`, existing subscription-related tests, `npm run build`.

### Task 2 — Complete: Enforce archived-branch access and order barriers

**Files:**
- Modify: `QR_FOOD_ORDER_BE/src/middleware/auth.ts`
- Modify: `QR_FOOD_ORDER_BE/src/routes/authRoutes.ts`
- Modify: `QR_FOOD_ORDER_BE/src/routes/restaurantRoutes.ts`
- Modify: `QR_FOOD_ORDER_BE/src/routes/orderRoutes.ts`
- Modify: `QR_FOOD_ORDER_BE/src/services/tableSessionLifecycleService.ts` if needed for safe session creation
- Add/modify: focused tests under `QR_FOOD_ORDER_BE/src/tests/`
- Modify: `QR_FOOD_ORDER_BE/package.json` only if a separate test command is added

**Implementation:**
1. Write failing tests for public restaurant lookup/order/session rejection and archived admin/staff login plus already-issued JWT denial.
2. Reject archived branches at all customer-facing restaurant/order/session entry points; recheck archive state immediately before creating a new table session/order where the existing service boundary permits it. Serialize order creation and bill update with archive through the same owner quota lease to close the in-flight order race.
3. Reject archived branch-bound admin/staff JWTs in `requireAuth`. For owner JWT requests carrying an archived selected branch, allow only the owner archive list/action/restore endpoints required for recovery; reject other branch operations.
4. Preserve normal behavior for non-archived branches and previously inactive branches (archive marker, not generic `status`/`active`, is the new access condition).

**Verification:** focused new tests, existing table-session/order tests, `npm run build`.

### Task 3 — Complete: Add owner archive/restore UX

**Files:**
- Modify: `QR_FOOD_ORDER_FE/src/services/ownerRestaurantService.ts`
- Modify: `QR_FOOD_ORDER_FE/src/pages/OwnerDashboard.tsx`
- Modify: `QR_FOOD_ORDER_FE/src/components/layout/DashboardLayout.tsx` only if selection recovery requires it
- Add: a focused policy/service test under `QR_FOOD_ORDER_FE/tests/` if behavior can be tested without introducing a new UI test stack

**Implementation:**
1. Add tests for archived-list query construction and safe selected-branch fallback policy where applicable.
2. Add the archived query filter, `archiveRestaurant`, and `restoreRestaurant` methods.
3. Add active/archived dashboard views, accessible archive confirmation, archive blocker messaging, restore action, archived dates, pending states, and empty states.
4. After archiving the selected branch, select another active branch or clear local selection; never select an archived branch for normal management.
5. Apply successful mutations optimistically and refresh each list independently so a failed refresh does not report a successful archive/restore as failed or retain an archived selection.
6. Show the backend plan-limit message when restore is rejected.

**Verification:** focused frontend tests, `npm run lint`, `npm run build`.

### Task 4 — Complete locally: Full regression, security review, and CI readiness

**Files:**
- No planned feature files; only fix issues found by verification/review.

**Implementation:**
1. Re-read this plan/spec and verify each acceptance criterion against implementation and tests.
2. Review all archive reads/writes for owner scoping, no cascade deletion, stale-token denial, and correct session/bill status sets.
3. Run both actual repository CI command sets in their respective repositories, including lockfile/install validation when safe, encoding, lint, all test scripts, and builds. Do not stop local Vite processes automatically.
4. Check git status/diffs; report any unavailable hosted CI as unverified because no push was authorized.

**Verification:** FE `npm ci`, `npm run check:encoding`, `npm run lint`, `npm run test:ci`, `npm run build`; BE `npm ci`, `npm run test:ci`, `npm run build`. If `npm ci` cannot safely run because a dev server holds files, do not kill it; report and ask the user to close it.

## Execution notes

- FE and BE are separate Git repositories; both are already on the task branch `Thang_ArchiveRestaurant` from updated `main`.
- The design spec is `docs/superpowers/specs/2026-09-25-owner-restaurant-archive-design.md` in the BE repository.
- The detailed plan is `docs/superpowers/plans/2026-09-25-owner-restaurant-archive.md` in the BE repository.
- No push, PR, or merge is part of this task.
- Backend and frontend CI scripts, builds, FE encoding validation, and FE lint completed successfully on this branch. FE lint reports existing warnings; it has no errors. Frontend build emits the existing large-chunk advisory.
- `npm ci --dry-run --ignore-scripts` passed in both repos for lockfile/install-plan validation. A destructive clean install was not run while local dev-server/watch processes may hold files.
- Hosted CI is unverified because this task has not been pushed and no PR was authorized.
