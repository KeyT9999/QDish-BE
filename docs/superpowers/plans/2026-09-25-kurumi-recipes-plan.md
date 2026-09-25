# KURUMI demo recipe seed plan

> Execute inline on `Thang_FixBug`; the user explicitly approved estimated demo recipes and filling the target database.

**Goal:** Populate all 181 official KURUMI menu items with plausible vegan, one-serving recipe rows.

**Design:** Extract ingredient names from the official menu descriptions where available, infer missing recipe components from item names/categories, estimate portion weights and preparation methods, and store ingredients as unverified restaurant-scoped records without nutrient facts. Use a guarded, idempotent dry-run/apply script.

**Tech:** TypeScript, `tsx`, Mongoose, Node assert tests, existing KURUMI menu snapshot and guarded seed utilities.

## Tasks

1. [x] Add failing pure tests for recipe coverage, estimates, vegan ingredient safety, and patch isolation.
2. [x] Implement the recipe inference/portion catalog and deterministic ingredient planner; make focused tests pass.
3. [x] Add guarded `seed:kurumi-recipes` script; dry-run by default and assert exact account/database/host before writes.
4. [x] Run dry-run, inspect recipe samples and ingredient counts, then apply to the already approved `Anvatcuti2` demo restaurant.
5. [x] Verify 181 persisted recipes plus preservation of unrelated records and nutrition caches.
6. [x] Run `npm ci`, `npm run test:ci`, `npm run build`, `git diff --check`; inspect CI status without pushing unless separately authorized.
