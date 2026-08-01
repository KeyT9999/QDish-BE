# Local-First Recommendation Profile Design

**Date:** 2026-08-01
**Status:** Approved
**Repositories:** `QR_FOOD_ORDER_BE`, `QR_FOOD_ORDER_FE`

## Problem

The customer menu currently has two profile sources:

- Fit Score reads `qdish_dining_profile` from browser storage and sends it in the batch request.
- Recommendation sends a generated `userId`; the server then reads `UserDiningProfile` from MongoDB.

The browser profile can change without updating the MongoDB profile. Fit Score and Recommendation can therefore disagree about the same diner's goals, preferences, or allergies. The anonymous profile endpoints also allow access by a caller-supplied `userId`, making server-side guest profiles vulnerable to tampering and unsuitable as the source of truth for safety-sensitive recommendations.

## Decisions

1. The browser profile is the only source of truth for anonymous diners.
2. The same local profile is shared across restaurants on the same browser/device.
3. Recommendation receives a validated profile snapshot in each request, as Fit Score already does.
4. `UserDiningProfile` endpoints and the model remain temporarily for old clients but are deprecated and unused by the new customer flow.
5. A legacy Recommendation request containing only `userId` remains accepted. The server ignores `userId` and returns general recommendations.
6. Allergies are hard safety constraints in both general and personalized modes.
7. Medical `conditions` remain local and are not sent to Recommendation.
8. The local profile persists until the diner explicitly edits or clears it.

## Scope

### In scope

- One local profile envelope with migration from the current plain profile shape.
- Inline profile contract for `POST /api/recommendations`.
- Strict request validation and bounded arrays.
- Explicit `GENERAL` and `PERSONALIZED` recommendation modes.
- Allergen-safe dish and pairing filtering.
- Generic Recommendation behavior when goals and preferences are empty.
- Removal of anonymous profile API calls from onboarding and Recommendation.
- Profile reset UX.
- Regression and browser tests for the complete flow.

### Out of scope

- Deleting the `UserDiningProfile` collection, model, or routes.
- Synchronizing anonymous profiles across devices.
- Registered customer accounts or cloud profile recovery.
- Medical-condition scoring or medical advice.
- Changing subscription tiers or Recommendation entitlement rules.
- Replacing the deterministic Recommendation/Fit Score engines with an ML model.

## Local Profile Contract

The storage key remains global to the browser:

```text
qdish_dining_profile
```

Its stored value becomes a versioned envelope:

```ts
interface StoredDiningProfile {
  schemaVersion: 1;
  updatedAt: string; // ISO-8601 UTC timestamp
  profile: {
    goals: string[];
    preferences: string[];
    allergies: string[];
    conditions: string[];
  };
}
```

`useDiningProfile` continues exposing a plain `DiningProfile` to components, plus metadata and actions:

```ts
{
  profile: DiningProfile;
  updatedAt?: string;
  saveProfile(profile: DiningProfile): void;
  clearProfile(): void;
}
```

Migration rules:

1. A valid version-1 envelope is loaded directly.
2. The existing plain `qdish_dining_profile` object is normalized and rewritten as version 1.
3. The older `qdish_health_profile` value is normalized, rewritten as version 1, and removed.
4. Invalid JSON, invalid shapes, or unknown future versions produce the empty default profile without throwing.
5. Saving normalizes arrays, updates `updatedAt`, and writes version 1.
6. Clearing removes the storage key and restores the empty in-memory profile.

The profile is not keyed by restaurant and has no automatic expiry.

## Recommendation Request Contract

`POST /api/recommendations` accepts:

```ts
interface RecommendationRequest {
  restaurantId: string;
  userProfile?: {
    goals: string[];
    preferences: string[];
    allergies: string[];
  };
  context?: {
    timeOfDay?: "breakfast" | "lunch" | "dinner" | "late_night";
    postWorkout?: boolean;
    weather?: "hot" | "cold" | "rainy";
    occasion?: "casual" | "date" | "family";
  };
  userId?: string; // deprecated compatibility field; accepted and ignored
}
```

Validation occurs before owner lookup, plan lookup, profile handling, or scoring:

- `restaurantId` must be a MongoDB ObjectId string.
- `userProfile` may be omitted.
- If `userProfile` is present, all three arrays must be present.
- Each array contains at most 10 entries.
- Duplicate entries are rejected.
- Every entry must be a string in the shared goals/preferences/allergies allowlist already used by batch Fit Score.
- `conditions` and unknown profile fields are not consumed.
- Context fields use the existing strict Fit Score allowlists and boolean checks.
- `userId` must never be used in a database query in the Recommendation flow.

Invalid input returns HTTP 400 with a stable generic message and does not invoke Recommendation calculation.

## Recommendation Modes

The server determines mode; the frontend does not infer it:

```ts
type RecommendationMode = "GENERAL" | "PERSONALIZED";
```

- `PERSONALIZED`: at least one goal or preference exists.
- `GENERAL`: profile is omitted, or both goals and preferences are empty.
- Allergies alone keep the mode `GENERAL`; safety filtering still applies.

The successful response extends the existing response additively:

```ts
interface RecommendationResponse {
  mode: RecommendationMode;
  emptyReason?: "NO_AVAILABLE_DISHES" | "NO_ALLERGEN_SAFE_DISHES";
  bestForYou: RecommendedDish[];
  fullMenu: ScoredDish[];
  pairingSuggestions: PairingSuggestion[];
}
```

Existing arrays and item fields remain intact for client compatibility.

## Ranking and Copy

### Personalized mode

- Reuse the canonical `FitScoreEngine.resolvePrimaryScoreType` mapping.
- If no mapped goal exists but a preference exists, use the best context returned by the engine.
- Personalized reason copy may refer to the diner's selected goal or preference.

### General mode

- Calculate available contexts without inventing a default user goal.
- Rank using the best context after applying the validated dining context, so time of day can influence ordering.
- Reason copy describes the dish and current meal context, not “khẩu vị của bạn” or another personalized claim.
- The UI title is `Gợi ý phù hợp lúc này`.
- General recommendations never display a personalized Fit Score badge.

The personalized UI title is `Gợi ý dành cho bạn`.

## Allergen Safety

Allergy handling is identical in both modes:

1. Build a case-insensitive union of allergens declared on the menu item and its cached nutrition profile.
2. Remove conflicting dishes before constructing `bestForYou` and `fullMenu`.
3. Remove conflicting dishes from pairing candidates.
4. Never reintroduce a conflicting dish as a fallback.
5. If available dishes exist but none are safe, return empty arrays with `emptyReason: "NO_ALLERGEN_SAFE_DISHES"`.
6. The frontend displays `Chưa tìm thấy món phù hợp với dị ứng đã chọn` for that reason.

This response is not medical advice; it reflects only the restaurant's declared ingredient/allergen data.

## Frontend Data Flow

1. `useDiningProfile` loads and migrates the shared local profile.
2. Onboarding saves the profile locally and records the already-approved restaurant-scoped anonymous analytics event.
3. Onboarding no longer calls `/api/users/profile/:userId/onboarding`.
4. CustomerMenu sends `{ goals, preferences, allergies }` inline to Recommendation. It never sends `conditions`.
5. The generated guest `userId` is removed from the new onboarding and Recommendation path.
6. Editing or clearing the profile changes React state and re-runs Recommendation and Fit Score effects.
7. Recommendation uses the same scheduled `timeOfDay` bucket already used by Fit Score, preventing the two features from drifting across meal boundaries.
8. `mode` controls the Recommendation heading and whether legacy Recommendation-only Fit Score presentation is eligible.

## Profile Reset UX

`DiningProfileForm` receives an optional `onClearProfile` action.

- Show `Xóa hồ sơ ăn uống` only when the profile contains at least one selected value.
- Require confirmation before clearing.
- Confirmation explains that goals, preferences, allergies, and conditions stored on this device will be removed.
- Clearing closes or resets the form, removes local storage, hides personalized Fit Score, and reloads Recommendation in `GENERAL` mode.
- The reset action does not delete server data because the new flow does not store anonymous profile data there.

## Deprecation Strategy

- Keep `UserDiningProfile`, `/api/users/profile/:userId`, and `/onboarding` operational for old clients.
- Mark the routes as deprecated in code documentation.
- Do not import or query `UserDiningProfile` from `recommendationRoutes.ts`.
- Do not use legacy server data as a fallback.
- A later, separately approved removal task may measure remaining traffic and delete the deprecated model/routes.

## Error Handling

- Invalid Recommendation input returns 400 and no calculation occurs.
- Missing restaurant/owner returns the existing non-disclosing 404 behavior.
- Disabled `recommendationEnabled` returns the existing 403 behavior.
- Unexpected failures return the existing generic 500 response; no stack trace or raw database error is serialized.
- Frontend Recommendation failure remains non-blocking and leaves the menu/cart usable.
- A network failure does not trigger a server-profile fallback.

## Testing

### Backend

- Inline goals/preferences/allergies reach the engine unchanged after validation.
- `userId`-only requests produce `GENERAL` mode and never query `UserDiningProfile`.
- Missing profile produces `GENERAL`; goals or preferences produce `PERSONALIZED`; allergies-only produces `GENERAL`.
- ObjectId, array presence, array length, duplicates, enums, context values, and object-injection cases are rejected before calculation.
- Menu and cached-profile allergen union hard-blocks conflicting dishes.
- Conflicting dishes are absent from `bestForYou`, `fullMenu`, and pairing candidates.
- No-safe-dish and no-available-dish reasons are distinguished.
- Recommendation entitlement behavior remains unchanged.
- Existing response arrays remain backward compatible.

### Frontend unit tests

- Plain and legacy profile values migrate to the versioned envelope.
- Invalid/future storage values fail safely.
- Save updates `updatedAt`; clear removes storage and resets state.
- Recommendation request contains only goals/preferences/allergies and the shared time bucket.
- Conditions and `userId` are absent from the new request.
- Mode-to-heading and empty-reason copy are deterministic.

### Browser tests

- Onboarding completes without a guest-profile API request.
- General mode shows `Gợi ý phù hợp lúc này` and no personalized Fit Score badge.
- Personalized mode shows `Gợi ý dành cho bạn`.
- Allergies-only mode remains general and excludes blocked items.
- No safe dish shows the approved empty state.
- Editing the local profile updates both Fit Score and Recommendation requests.
- Clearing the profile requires confirmation, removes storage, hides personalized Fit Score, and returns Recommendation to general mode.

## Success Criteria

- Fit Score and Recommendation consume the same current browser profile.
- The new anonymous flow performs no read or write against `UserDiningProfile`.
- Old `userId`-only Recommendation requests do not fail and do not read server profile data.
- No allergen-conflicting dish or pairing is returned.
- Generic output is clearly distinguished from personalized output.
- Profile reset is explicit and persistent on the device.
- Existing subscription gating, menu/cart behavior, and response arrays remain intact.
