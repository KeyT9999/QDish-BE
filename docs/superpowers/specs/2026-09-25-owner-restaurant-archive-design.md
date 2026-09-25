# Owner Restaurant Archive — Design Spec

## Goal

Let a restaurant owner stop using a branch without deleting any business or historical data, then restore it later if their subscription allows it.

## Decisions

- This is reversible archiving, not deletion. Orders, bills, tables, menu items, staff accounts, ingredients, customer records, and other linked documents remain untouched.
- Add `archivedAt` and `archivedByOwnerId` to `Restaurant`. A missing or null `archivedAt` means active; a date means archived. Do not overwrite `status` or `active`, so restoring preserves the branch's pre-archive operating state.
- Only the authenticated `RESTAURANT_OWNER` who owns the branch may archive or restore it. Wrong-owner IDs remain indistinguishable from missing IDs (404).
- Archive is exposed as `DELETE /api/owner/restaurants/:restaurantId` (soft-delete semantics), and restore as `POST /api/owner/restaurants/:restaurantId/restore`.
- The owner restaurant list defaults to active branches. `GET /api/owner/restaurants?archived=true` returns only archived branches.
- Archive is rejected with HTTP 409 and code `RESTAURANT_HAS_OPEN_ACTIVITY` while any `TableSession` is `OPEN` or `PAYMENT_REQUESTED`, or any `Bill` is `UNPAID` or `PAYMENT_REQUESTED`. Return `activeSessions` and `unpaidBills` counts for a useful message.
- Restore is rejected when `RESTAURANT_LIMIT` is reached, using HTTP 403, code `PLAN_LIMIT_REACHED`, and the existing plan-limit response fields. Archived branches do not count toward `restaurantCount`; their historical tables/menu/staff continue to count toward those separate quotas, avoiding unrelated quota changes.
- Archived branches are excluded from active owner lists and branch switching, blocked from public restaurant details and new order/session creation, and rejected by existing branch admin/staff JWTs. Owners can still list archived branches and restore them.
- The existing super-admin hard-delete endpoint is unchanged.
- Do not change subscriptions, user activation flags, or cascade/delete linked data.

## API shapes

Archive success (including repeat archive by the same owner):

```json
{ "restaurantId": "<id>", "archivedAt": "<ISO timestamp>" }
```

Activity conflict:

```json
{
  "code": "RESTAURANT_HAS_OPEN_ACTIVITY",
  "message": "Đóng các phiên bàn và thanh toán hết hóa đơn trước khi lưu trữ chi nhánh.",
  "activeSessions": 1,
  "unpaidBills": 0
}
```

Restore success returns the restored restaurant and clears its archive marker. Plan-limit failures follow the current create-branch response shape and include current plan/limit/usage details.

## Security and consistency

- Always scope archive/restore reads and writes by both restaurant ID and `ownerId`.
- Set the archive marker with an owner-scoped conditional update; do not delete or mutate linked records.
- Check both active-session and active-bill status sets used by the existing lifecycle services.
- Recheck archive state on the customer order/session path and reject archived branch-bound admin/staff access, including already-issued JWTs. Hold the shared owner quota lease across order insertion and bill update, the same lease used by archive, so archive and in-flight order writes cannot cross; return a retryable 503 when that lease is busy.
- Allow only the owner archive-list and restore/archive routes to operate when an owner request carries a selected archived branch ID, so a stale local branch selection cannot prevent recovery.

## UX

- The owner dashboard has clear “Đang hoạt động” and “Đã lưu trữ” views.
- Active cards offer a clearly labeled archive action with a confirmation dialog explaining that data is retained and open sessions/bills must be closed first.
- Archived cards show archive date and a restore action. Restore conflicts explain the plan branch limit.
- Archiving the selected branch moves the current selection to another active branch, or clears the selection if none remain.
- Successful archive/restore state is retained even if a follow-up list refresh fails; each list refresh is independent, and archiving the selected branch always clears or replaces that selection.
- Loading, empty, error, and per-row pending states remain usable and accessible.

## Acceptance criteria

1. An owner can archive an owned branch with no active session or unpaid bill; linked documents remain unchanged.
2. Archive returns 409 with counts if either blocking activity exists.
3. Non-owners cannot archive or restore a branch; other owners cannot access it through ID guessing.
4. Archived branches disappear from normal branch lists/switchers, public restaurant lookup, customer order/session creation, and restaurant admin/staff access.
5. An archived branch does not count toward restaurant plan quota; restoring it does, and is denied if that would exceed the current plan limit.
6. Owner can view the archived list and restore a branch; restoration retains its prior `status`/`active` values and all linked data.
7. FE presents active/archive lists, archive confirmation, restore action, relevant conflict messages, and correct selected-branch fallback.
8. FE and BE local CI workflows pass. Hosted CI remains unverified until changes are pushed to a PR.
