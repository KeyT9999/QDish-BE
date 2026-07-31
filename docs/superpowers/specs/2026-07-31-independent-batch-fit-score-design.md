# Independent Batch Fit Score Design

## Status

Approved in conversation on 2026-07-31. This document defines the implementation boundary for an independent Fit Score experience in the customer menu.

## Problem

The backend exposes per-dish Fit Score endpoints, but the frontend does not call them. Customers only see Fit Score badges on up to three dishes returned by the Recommendation Engine. Ordinary menu cards and dish details do not have an independent Fit Score experience.

Fit Score and Recommendation are separate plan capabilities. Fit Score must work whenever `fitScoreEnabled` is true, even when `recommendationEnabled` is false.

## Product Decisions

- Display Fit Score on ordinary menu cards and in dish details.
- Display one personalized score based on the current anonymous dining profile and current dining context.
- Do not display or request Fit Score until the guest has selected at least one goal or dietary preference.
- Keep Fit Score independent from Recommendation entitlements.
- Retain the existing per-dish Fit Score endpoints for backward compatibility.
- Continue using the anonymous profile stored in the browser. The batch request does not create a new server-side identity record.

## API Contract

### Endpoint

```http
POST /api/dishes/fit-scores
```

### Request

```json
{
  "restaurantId": "507f1f77bcf86cd799439011",
  "userProfile": {
    "goals": ["MUSCLE_GAIN"],
    "preferences": ["HIGH_PROTEIN"],
    "allergies": ["SOY"]
  },
  "context": {
    "timeOfDay": "lunch",
    "postWorkout": false
  }
}
```

The route validates:

- `restaurantId` is a valid MongoDB ObjectId.
- Profile arrays are present, bounded, deduplicated, and contain only allowlisted values.
- `timeOfDay` is one of `breakfast`, `lunch`, `dinner`, or `late_night`.
- `postWorkout` is boolean when provided.

### Response

```json
{
  "scores": {
    "dish-id": {
      "score": 86,
      "label": "Rất phù hợp",
      "contextType": "gym_fit",
      "reasons": [
        "Giàu đạm, phù hợp mục tiêu tăng cơ",
        "Phù hợp với thời điểm dùng bữa hiện tại"
      ],
      "blocked": false
    }
  }
}
```

For an allergen conflict:

```json
{
  "score": 0,
  "label": "Có dị ứng",
  "contextType": "allergen_block",
  "reasons": ["Món có thành phần xung đột với dị ứng đã chọn"],
  "blocked": true,
  "blockReason": "allergen"
}
```

The response contains only dishes that belong to the requested restaurant and are currently available.

## Authorization and Plan Entitlement

The endpoint resolves the restaurant owner and active plan on the server. It returns `403` unless `plan.fitScoreEnabled === true`.

The route does not consult `recommendationEnabled`. Client-side feature flags are an optimization only and are not the authorization boundary.

## Backend Architecture

Introduce a batch Fit Score service responsible for:

1. Loading all available menu items for one restaurant.
2. Loading cached nutrition profiles in one query.
3. Calculating one personalized score for each dish with the existing `FitScoreEngine`.
4. Applying an allergen hard block before presenting a score.
5. Producing deterministic, non-LLM explanations from nutrition, profile matches, and context.

The service must not perform one database query per dish. Menu items and nutrition profiles are loaded in batches and joined in memory by `dishId`.

Primary scoring context follows the existing product semantics:

- `MUSCLE_GAIN` selects `gym_fit`.
- `WEIGHT_LOSS` or `LIGHT_MEAL` selects `quick_lunch_fit`.
- `ENERGY_BOOST` selects `energy_boost_fit`.
- `COMFORT` selects `late_night_fit`.
- `BALANCED` selects `office_lunch_fit`.
- When no goal maps directly, choose the highest calculated context score.

Shared context-selection logic should be extracted and reused by the Recommendation Engine so both systems do not drift.

## Frontend Architecture

Add a typed Fit Score service that calls the batch endpoint once per restaurant/profile/context combination.

`CustomerMenu` owns a `Record<dishId, FitScoreSummary>` and passes the relevant summary to:

- `MenuItemCard` for the compact badge.
- `MenuItemDetail` for the detailed explanation panel.
- The Recommendation carousel when it displays a Fit Score, ensuring the visible score has one canonical source.

The batch call runs only when:

- `restaurant.features.fitScoreEnabled === true`; and
- the local dining profile has at least one goal or preference.

Changing the restaurant, profile, or time-of-day bucket invalidates the in-memory result and triggers one new request. Persistent caching is outside this scope.

## UX Rules

### Menu Card

- Scores from 80 to 100 use a green `NN% phù hợp` badge.
- Scores from 60 to 79 use an amber badge.
- Scores below 60 use a neutral badge.
- Blocked dishes show a red `Có dị ứng` badge instead of `0%`.
- While the batch request is pending, the badge position may show a small skeleton without blocking the menu.

### Dish Detail

- Show the score, label, selected context, and at most three explanation bullets.
- A blocked result becomes an allergen safety panel and does not present the dish as recommended.
- Provide an action to reopen the dining-profile survey.

### No Profile

When the guest has no goals and no preferences, the frontend neither calls the endpoint nor renders Fit Score placeholders.

## Error Handling

- Invalid input returns `400` with a stable machine-readable error code.
- Missing restaurant or owner returns `404` without exposing cross-tenant details.
- A disabled Fit Score entitlement returns `403`.
- Unexpected backend failures return a generic `500` response and do not expose stack traces.
- Frontend request failures do not block menu browsing or ordering. The UI hides Fit Score for that attempt and avoids repeated error toasts.

## Testing Requirements

### Backend

- FREE or any plan with `fitScoreEnabled !== true` receives `403`.
- A plan with Fit Score enabled succeeds regardless of `recommendationEnabled`.
- Requests reject invalid restaurant IDs, profile values, oversized arrays, and invalid context values.
- Results contain only available dishes from the requested restaurant.
- Menu and nutrition data are loaded in batch, without per-dish database queries.
- Allergen conflicts return `blocked: true`, score zero, and no positive recommendation label.
- Primary context selection follows the documented goal mapping.
- Existing per-dish Fit Score and Recommendation regression tests continue to pass.

### Frontend

- No request occurs when Fit Score is disabled.
- No request occurs before goals or preferences exist.
- One batch request supplies all ordinary cards and the detail panel.
- Card and detail use the same score object.
- Blocked results render the allergen state rather than zero percent.
- Recommendation UI uses the batch score when available.
- Request failures leave the menu functional.

## Out of Scope

- Persisting Fit Score results in localStorage or the database.
- Adding a new logged-in customer identity model.
- Replacing or removing existing per-dish Fit Score endpoints.
- Redesigning the Recommendation algorithm or pairing suggestions.
- Changing plan prices or seeded plan entitlements.
