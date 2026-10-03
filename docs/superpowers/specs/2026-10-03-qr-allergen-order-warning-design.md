# QR Allergen Order Warnings — Design Spec

## Goal

Let a diner disclose food allergies during QR ordering, see a clear warning for menu items that conflict with that disclosure, and still choose whether to order. Carry verified, item-specific warnings to the restaurant order and bill so staff can see them before preparing food.

## Current behavior

- The customer dining profile is stored in browser local storage.
- The allergy onboarding is automatically shown only when the restaurant has personalized-menu entitlement.
- The menu item model has an allergens array, but an empty array does not distinguish “reviewed and none” from “not reviewed.”
- FE blocks adding a conflicting item to the cart.
- Order submission sends a free-form note, but not declared allergies.
- BE stores order notes and copies the free-form note to bill item snapshots.

## Decisions

1. Allergy disclosure is available to every guest using a restaurant QR. Goals and dietary personalization remain behind the existing restaurant feature entitlement.
2. Guests may skip the survey or declare no allergies. Allergy conflict warnings inform the guest and restaurant; they never block adding or submitting a dish.
3. The browser keeps the profile for menu display. On order submission, FE sends only the selected allergy codes in a bounded reportedAllergies array. It never sends computed conflict claims as authoritative data.
4. BE validates the reported allergy codes and computes each order line’s conflict from restaurant-scoped MenuItem records. The server does not trust client allergen arrays or warning labels.
5. Add allergenInfoStatus to MenuItem with UNKNOWN and REVIEWED values. New records default to UNKNOWN; API serialization treats the missing field on legacy records as UNKNOWN. REVIEWED with an empty allergens array means the restaurant reviewed the data and declared no listed allergens. UNKNOWN means the system must not imply safety.
6. Any change to recipe inputs or derived allergen data resets the item to UNKNOWN. The restaurant reviews the persisted recalculation and confirms it in a separate status-only action; a single recipe-save request cannot both change the recipe and mark the result REVIEWED.
7. Each Order item snapshots allergenInfoStatus and the known allergenWarnings at order time. If at least one line is UNKNOWN and the guest reported allergies, the order retains reportedAllergies for staff context; otherwise the full disclosure list is not persisted.
8. Bill item snapshots copy the order-time status and warning codes. For UNKNOWN lines, copy the order-level reportedAllergies needed by staff. Bill line merging must keep items with different warning states or UNKNOWN allergy contexts separate. The existing customer-authored order note remains independent.
9. If a menu record cannot be resolved for an order line, mark its allergen data UNKNOWN and preserve existing ordering behavior. Do not claim the item is allergy-safe.
10. Show a concise cross-contact notice: allergy data comes from the restaurant, may not cover cross-contact, and guests with serious allergies should confirm with staff.
11. Do not add allergy selections to the restaurant customer CRM profile, logs, or analytics events. Persist only conflict snapshots and, when a line is UNKNOWN, the reported allergy codes needed for staff to respond.

## Allergen comparison algorithm

Allowed codes are the existing DINING_ALLERGIES list: GLUTEN, DAIRY, NUTS, SHELLFISH, SOY, EGGS, and FISH.

For each submitted order line:

1. Resolve the current menu item by both menu item ID and restaurant ID.
2. Normalize codes by trimming whitespace and uppercasing, then deduplicate.
3. If allergenInfoStatus is REVIEWED, set allergenWarnings to the intersection of the menu item’s declared allergens and the guest’s reportedAllergies.
4. If allergenInfoStatus is UNKNOWN or the menu item is unavailable to the lookup, set allergenWarnings to an empty array and retain UNKNOWN. If the guest disclosed allergies, add the disclosed codes to the order-level context only when at least one line is UNKNOWN.
5. Snapshot the result into Order.items before bill linking. Copy it into Bill.itemsSnapshot during bill aggregation, copying reportedAllergies to each UNKNOWN bill line.

The intersection identifies a declared menu conflict. An empty intersection does not guarantee absence of trace contamination or undeclared ingredients.

## User experience

### Guest

- The QR flow offers the allergy step regardless of premium personalization. Existing goals/preferences remain entitlement-gated.
- Menu cards and item details name the conflicting allergen, for example “Món này có chứa các loại hạt bạn đã khai báo dị ứng.”
- Every item with UNKNOWN metadata shows “Chưa xác nhận thông tin dị ứng của món này. Hãy hỏi nhân viên nếu bạn bị dị ứng.”, even when the guest has not declared an allergy.
- The add-to-cart action remains enabled for available items, including conflicting and UNKNOWN items.
- The cart repeats a concise warning beside each affected item.
- The guest can edit the profile before submitting. The latest selected allergy codes are sent with that order.
- The create-order response is scoped to the requesting browser. Shared table order history and the public current-bill response omit allergy status, conflict codes, and reported allergy codes so diners cannot inspect another guest’s health information.

### Restaurant

- Restaurant order and bill views show warnings under the exact affected line item.
- A reviewed conflict displays the intersecting menu declaration, for example “Món có khai báo chứa: Các loại hạt.”
- An UNKNOWN line in an order with reported allergies displays “Khách khai báo dị ứng: Các loại hạt; cần xác nhận thông tin dị ứng món.”
- Customer-authored notes continue to display as notes and are not overwritten by system warnings.
- Historical bills retain the warning snapshot calculated when the order was placed.

## API and data contract

Customer create-order request addition:

```json
{
  "reportedAllergies": ["NUTS"]
}
```

The field is optional, bounded to the known allergy codes, unique, and validated by BE. Unknown codes, non-string entries, duplicate values, or more than seven values return HTTP 400 with a localized validation message.

Order item snapshots add:

```json
{
  "allergenInfoStatus": "REVIEWED",
  "allergenWarnings": ["NUTS"]
}
```

The order may include reportedAllergies only when UNKNOWN item metadata makes it necessary for staff context. Bill item snapshots copy allergenInfoStatus and allergenWarnings, and copy reportedAllergies onto UNKNOWN lines. Client-provided versions of these computed fields are ignored.

## Menu data maintenance

- The restaurant menu list shows declared allergen codes and review status. An authorized user can mark allergen information reviewed from the item action menu, including a reviewed item with no listed allergens.
- Changing recipe inputs, allergen values, or recalculating derived allergens always resets allergenInfoStatus to UNKNOWN. Confirm the review in a separate request after the updated allergen list is loaded.
- Legacy records without allergenInfoStatus are interpreted as UNKNOWN until reviewed; no mass data migration is needed.
- Customer-facing labels make UNKNOWN visible without preventing an order.

## Privacy and access

Allergy data is sensitive. Keep browser storage behavior local-first. Do not attach the profile to RestaurantCustomer, TableSession, analytics, or logs. Persist only item conflict codes needed on the Order and Bill; persist the submitted codes for an order only when an UNKNOWN line needs staff context. Restaurant-authenticated order and bill views show the saved snapshots. Sanitize public table-scoped order history and current-bill responses by removing all allergen status, conflict, and reported-allergy fields; diners at the same table must not see another guest’s disclosure. The direct create-order response may return only the just-submitted order snapshot.

## Acceptance criteria

1. Any QR guest can open the allergy disclosure even when personalized-menu features are disabled; premium goals/preferences remain gated.
2. A guest selecting NUTS sees a named warning on a REVIEWED NUTS item, and can add and submit it.
3. An order containing a REVIEWED NUTS item stores NUTS on that item and the corresponding bill line; restaurant order and bill views show the warning under the correct item.
4. A REVIEWED item with no matching allergen does not receive a conflict warning.
5. An UNKNOWN item never appears as allergy-safe. When the guest reported allergies, the restaurant sees the disclosed codes and that the item data is unconfirmed.
6. A client cannot forge or suppress the server-computed conflict by changing submitted item allergens or warning arrays.
7. Customer-authored order notes remain distinct and visible alongside staff-only allergen warnings; public shared-table history does not expose allergy fields.
8. Two diners placing separate orders at one table retain separate order-time allergy snapshots.
9. Existing orders, bills, menu items, totals, bill grouping, and payment flows remain readable and correct.
10. Both repository CI quality jobs pass. Hosted CI is considered verified only for the exact PR head SHA after an authorized push; production deployment is not part of the PR plan.

## Out of scope

- Persisting allergy profiles in CRM or across restaurants.
- Blocking or requiring a confirmation modal for allergen-conflicting orders.
- Inferring allergens from free-form dish descriptions.
- Guaranteeing that a dish has no cross-contact risk.
- Replacing recommendation or nutrition scoring behavior.
