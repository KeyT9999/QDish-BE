type UnknownRecord = Record<string, any>;

function stripLineAllergenDetails<T extends UnknownRecord>(item: T) {
  const {
    allergenInfoStatus: _allergenInfoStatus,
    allergenWarnings: _allergenWarnings,
    allergenContainsWarnings: _allergenContainsWarnings,
    allergenMayContainWarnings: _allergenMayContainWarnings,
    allergenWarningSource: _allergenWarningSource,
    allergenInformationIncomplete: _allergenInformationIncomplete,
    allergyDisclosureStatus: _allergyDisclosureStatus,
    reportedAllergies: _reportedAllergies,
    ...publicItem
  } = item;
  return publicItem;
}

export function sanitizeCustomerOrderForPublicRead<T extends UnknownRecord>(order: T) {
  const {
    reportedAllergies: _reportedAllergies,
    allergyDisclosureStatus: _allergyDisclosureStatus,
    ...publicOrder
  } = order;
  return {
    ...publicOrder,
    items: Array.isArray(order.items)
      ? order.items.map((item: UnknownRecord) => stripLineAllergenDetails(item))
      : order.items
  };
}

export function sanitizeCustomerBillForPublicRead<T extends UnknownRecord>(result: T) {
  return {
    ...result,
    bill: result.bill
      ? {
          ...result.bill,
          itemsSnapshot: Array.isArray(result.bill.itemsSnapshot)
            ? result.bill.itemsSnapshot.map((item: UnknownRecord) => stripLineAllergenDetails(item))
            : result.bill.itemsSnapshot
        }
      : result.bill,
    orders: Array.isArray(result.orders)
      ? result.orders.map((order: UnknownRecord) => sanitizeCustomerOrderForPublicRead(order))
      : result.orders
  };
}
