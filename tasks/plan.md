# Implementation Plan: Auto-expire Unordered Table Sessions

## Overview

Automatically release a table when a customer QR session has been open for 15 minutes without any order. The backend remains the source of truth, closes empty bills created during QR resolution, prevents expiry from racing with order creation, and notifies the restaurant dashboard in real time.

## Architecture Decisions

- Keep the existing `TableSession` lifecycle and use `CANCELLED` with metadata reason `AUTO_EXPIRED_NO_ORDER` for backward compatibility.
- Use `openedAt` as the timeout origin. A scan-only session does not become immortal because a browser refreshes or a customer browses the menu.
- Auto-expire only `OPEN` sessions created by `CUSTOMER_SCAN` with no orders. Never auto-expire `PAYMENT_REQUESTED` sessions or sessions that already contain an order.
- Run a backend cleanup worker every minute, plus a lazy expiry check while resolving a table session so stale sessions are never reused.
- Serialize expiry and order writes through the existing restaurant order-write lease and re-read the session inside the critical section.
- Release the table only when its `activeSessionId` still points to the expired session, preventing an old cleanup from clearing a newer session.
- Cancel the zero-order bill associated with an expired session and emit the existing table/session socket events.

## Task List

### Phase 1: Backend lifecycle

- [x] Add a focused expiry service with injectable dependencies and a 15-minute default timeout.
- [x] Add regression tests for expiry, non-expiry with an order, idempotency, stale-session resolution, and zero-order bill cancellation.
- [x] Integrate lazy expiry into QR session resolution and re-check session state during order writes.

### Checkpoint: Backend behavior

- [x] Focused table-session tests pass.
- [x] Existing bill and order lifecycle tests pass.
- [x] Backend type-check/build succeeds.

### Phase 2: Background cleanup and realtime

- [x] Add the interval worker and initialize it with the backend.
- [x] Emit `table-session:closed` and `table:status-updated` for automatic releases.
- [x] Make the frontend dashboard update table data when the table status event arrives.

### Checkpoint: User-visible flow

- [ ] A stale scan-only table becomes `AVAILABLE` without a manual refresh after the socket event (runtime browser check pending).
- [ ] An order placed before the timeout keeps the session active in a live browser/API flow (covered by lifecycle guards; integration check pending).
- [ ] An old customer page receives the existing rescan error after its session expires (runtime browser check pending).

### Phase 3: Verification

- [x] Run backend `npm run test:ci` and `npm run build`.
- [x] Run frontend `npm run test:ci`, `npm run lint`, and `npm run build`.
- [x] Run `git diff --check`, inspect both repository diffs, and confirm no generated or secret files changed.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Expiry races with a customer order | High | Re-read session state under the existing restaurant write lease and use conditional state transitions. |
| Empty bills remain active | High | Cancel only the bill with no order IDs when the session expires. |
| Multiple backend instances run cleanup together | Medium | Use an atomic session claim/update; repeated workers become no-ops. |
| Dashboard remains stale | Medium | Emit existing table/session events and refresh tables in the existing realtime hook. |
| A staff-created session is closed unexpectedly | Medium | Restrict automatic expiry to `createdBy = CUSTOMER_SCAN`. |

## Open Questions

- The timeout is fixed at 15 minutes for this implementation. A restaurant-level setting can be added later if different restaurant styles need different thresholds.
