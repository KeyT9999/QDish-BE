# KURUMI Da Nang menu seed design

## Goal

Populate the existing KURUMI restaurant linked to the requested development account with the current public Da Nang menu, while preserving unrelated restaurant operations and avoiding invented recipe or nutrition facts.

## Source and snapshot

- Primary source: <https://kurumi.vn/vi/menu?branch=danang>
- Branch details: <https://kurumi.vn/en/locations/danang>
- The Vietnamese menu page exposes 30 structured menu sections and 182 item rows. The six `Gọi thêm - ...` sections are grouped into one application category, resulting in 25 KURUMI menu categories. One duplicated `Latte Sữa Yến Mạch` row is identical and will be de-duplicated, so 181 unique menu items are imported.
- Use source Vietnamese names, listed VND prices, descriptions, availability, and official image URLs when present. Missing descriptions/images remain empty; do not fabricate them.

## Target and existing state

- Resolve the account by normalized username and follow its `restaurantId`; require exactly one matching account and restaurant before any write.
- The account is linked to the KURUMI restaurant record. Current read-only snapshot: 4 categories, 5 menu items, 10 tables. The restaurant is on PRO, whose current menu limit is unlimited.
- Preserve the existing five menu records and all tables. Four current menu items are unrelated to the published vegan menu and are available; they will remain unchanged in this seed operation. Hiding or removing legacy items is a separate change requiring approval.

## Data behavior

- Update only the restaurant's public `name`, `address`, and `phone` from the official branch page. Preserve owner, email, banking, payment, and subscription fields. Opening hours are not in the current restaurant schema and will not be added in this task.
- Upsert official menu categories and menu items by restaurant + normalized category/name, making repeat runs idempotent and avoiding deletes.
- Collapse the six published add-on sections into the `Gọi thêm` category because the current application has no modifier model.
- Keep structured recipe quantities, nutrition values, and allergen assertions unset/empty because the public menu does not provide verified measurements or those facts. Do not create ingredients, stock counts, orders, bills, customers, or tables.
- Store menu photos only as the official `kurumi.vn` HTTPS image URLs present in the source snapshot; leave missing URLs blank.

## Execution safety

- Store the reviewed menu snapshot and its source URL in the backend seed implementation; never store account credentials or database connection strings in source control.
- Default to a no-write dry run. Applying requires an explicit `--apply` argument and re-validates the exact account/restaurant link before mutation.
- Report only aggregate create/update counts and a non-sensitive restaurant label. Never print credentials, connection strings, password hashes, or raw database errors.
- Writes are additive/upsert-only; a partial run can be safely repeated. No destructive cleanup is included.

## Verification and acceptance

- Unit tests cover source-section grouping, duplicate-row removal, input validation, and deterministic upsert keys.
- Dry run reports 25 official categories and 181 unique source menu items for the verified target, with no database changes.
- Apply updates the existing restaurant profile, adds/upserts those menu records, and leaves existing tables, payment configuration, account fields, and unrelated menu records unchanged.
- Verify persisted counts and representative items, then run backend build, full CI test script, and configured GitHub CI checks before claiming completion.

## Known limitation

Because legacy records are intentionally preserved, the account may still display four currently available non-KURUMI items alongside the imported menu. Disabling those entries is not authorized by this design.
