# KURUMI Da Nang Menu Seed Implementation Plan

> **For agentic workers:** Execute each checkbox in order and keep every step testable. This plan is being run inline in the existing `Thang_FixBug` branch.

**Goal:** Seed the verified KURUMI restaurant with its current Vietnamese Da Nang menu, idempotently and without changing unrelated operational data.

**Architecture:** Check in a reviewed snapshot extracted from KURUMI's official structured menu data, normalize it with pure functions, and use a guarded one-off Mongoose script to upsert only restaurant profile fields, categories, and menu listing fields. Dry-run is the default; writes require `--apply` plus an explicit database-name confirmation.

**Tech Stack:** Node.js 24, TypeScript 5.6, `tsx`, Mongoose 8.5, existing Node `assert` test conventions.

## Global Constraints

- Official menu source: `https://kurumi.vn/vi/menu?branch=danang`; official branch source: `https://kurumi.vn/en/locations/danang`.
- Collapse the six `Gọi thêm - ...` source sections into one `Gọi thêm` category; de-duplicate the exact repeated Latte row, yielding 25 categories and 181 unique items.
- Never include account passwords, MongoDB URIs, hashes, or database IDs in committed data or output.
- Never delete data or modify tables, owner/email, subscription, banking, or payment configuration.
- Preserve structured recipe quantities, nutrition, and allergen fields; import only published names, VND prices, descriptions, availability, and official image URLs.
- Default execution is read-only; mutation requires `--apply --confirm-db QDish --confirm-host <exact-configured-host>` and revalidating the exact username-to-restaurant link.
- Preserve the four existing available non-KURUMI menu items; hiding them is out of scope.

---

### Task 1: Snapshot normalization and regression tests

**Files:**
- Create: `src/scripts/kurumiDaNangMenuSnapshot.ts`
- Create: `src/scripts/kurumiMenuSeedData.ts`
- Test: `src/tests/kurumiMenuSeedData.test.ts`

**Interfaces:**
- `normalizeKurumiMenuSections(sections)` returns `{ categories: string[]; items: KurumiMenuItem[] }`.
- `KurumiMenuItem` contains `category`, `name`, `description`, `price`, `imageUrl`, and `available`.
- `kurumiDaNangMenuSnapshot` exports the checked-in source sections and source metadata from `src/scripts/kurumiDaNangMenuSnapshot.ts`.
- `buildMenuItemListingPatch(item, categoryId)` returns only the listing fields to set, excluding recipe and nutrition fields.

- [x] Write a failing Node-assert test proving that six add-on sections collapse to `Gọi thêm`, identical rows deduplicate, distinct-price rows remain distinct, malformed prices/URLs are rejected, and the official snapshot normalizes to 25 categories / 181 items.
- [x] Run `npx tsx src/tests/kurumiMenuSeedData.test.ts`; verified the expected initial module-not-found failure.
- [x] Add the official structured-data TypeScript snapshot and pure normalizer; allow image URLs only when they use HTTPS and the exact `kurumi.vn` host.
- [x] Re-run the focused test and `npm run build`; both pass.
- [x] Review the snapshot diff for external hosts, duplicate item keys, malformed prices, missing descriptions, and non-menu data; one malformed source image was cleared rather than imported.

### Task 2: Guarded idempotent MongoDB importer

**Files:**
- Create: `src/scripts/seedKurumiRestaurant.ts`
- Modify: `package.json`
- Test: `src/tests/kurumiMenuSeedData.test.ts`

**Interfaces:**
- CLI: `npm run seed:kurumi -- --username <restaurant-account> [--apply --confirm-db QDish --confirm-host <exact-configured-host>]`.
- No `--apply`: print a sanitized plan only; make no writes.
- `--apply`: require the explicit database name and exact configured host to match the configured URI and require exactly one username/restaurant match with `restaurant.username` matching the account.
- Upsert menu listing fields only; preserve recipe, nutrition, allergen, and other existing item fields.

- [ ] Add tests for deterministic normalized keys and for `buildMenuItemListingPatch` preserving existing `ingredients`, nutrition, and `foodAttributes` when applied to a menu document.
- [ ] Run the focused test and verify it fails before implementing the helper behavior.
- [ ] Implement the CLI guards and sanitized dry-run; add `seed:kurumi` and `test:kurumi-seed` package scripts, and append the focused test to `test:ci`.
- [ ] Run focused tests and build; inspect `--help`/invalid-argument behavior without opening a database connection.
- [ ] Run the dry-run against the confirmed target; require exactly one matching account and restaurant, 25 official categories, 181 source items, and zero planned deletes.

### Task 3: Apply the approved seed and verify persisted state

**Files:**
- No additional source files; use `src/scripts/seedKurumiRestaurant.ts`.

- [ ] Record pre-apply aggregate counts for categories, menu items, and tables; verify the restaurant's existing public fields and payment settings will only be changed where specified.
- [ ] Run the script with `--apply --confirm-db QDish --confirm-host <configured-host>` for the approved account; do not print or pass its password.
- [ ] Query back counts and representative items (including an add-on, an item with an image, and an item without one); verify profile details, prices, availability, and images against the snapshot.
- [ ] Verify existing table count, legacy item records, owner/email, subscription, and payment fields remain unchanged; verify no duplicate `Latte Sữa Yến Mạch` was inserted.
- [ ] Run `npm run build` and `npm run test:ci`; inspect `git diff --check`, staged diff, and repository CI configuration. Do not claim GitHub CI passed unless that check actually ran.
- [ ] Commit the implementation after local verification; do not push without an authorized/established push step.

## Risk controls

| Risk | Mitigation |
|---|---|
| The Atlas target differs from the approved database | Require URI database name `QDish`, exact URI host confirmation, exact account/restaurant linkage, and both confirmation flags before writes. |
| Source data duplicates or changes | Use the checked-in snapshot, validate its counts, and deduplicate only exact same-category/name/price/description/image/availability records. |
| Re-run creates duplicate records | Upsert by restaurant + normalized category/name and use unique category lookups. |
| Legacy non-KURUMI dishes remain visible | Preserve them as specified and report this limitation; do not silently disable or delete them. |
| Public menu lacks recipe measurements/nutrition/allergens | Leave structured fields untouched/empty; do not synthesize health claims. |

## Acceptance

- Dry-run performs no writes and reports 25 categories / 181 unique official menu items for the single verified restaurant.
- Apply is idempotent, does not delete records, and does not modify tables, payment, ownership, or subscription data.
- Persisted representative menu values match the official source snapshot.
- Backend build and full `test:ci` pass; remote CI status is reported only if actually observed.
