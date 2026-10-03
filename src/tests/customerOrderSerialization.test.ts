import assert from "node:assert/strict";
import {
  sanitizeCustomerBillForPublicRead,
  sanitizeCustomerOrderForPublicRead
} from "../services/customerOrderSerialization.js";

const order = {
  id: "order-1",
  reportedAllergies: ["NUTS"],
  items: [{
    menuItemId: "dish-1",
    allergenInfoStatus: "REVIEWED",
    allergenWarnings: ["NUTS"],
    allergenContainsWarnings: ["NUTS"],
    allergenMayContainWarnings: []
  }]
};
const publicOrder = sanitizeCustomerOrderForPublicRead(order);
assert.equal(Object.prototype.hasOwnProperty.call(publicOrder, "reportedAllergies"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicOrder.items[0], "allergenInfoStatus"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicOrder.items[0], "allergenWarnings"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicOrder.items[0], "allergenContainsWarnings"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicOrder.items[0], "allergenMayContainWarnings"), false);
assert.equal(publicOrder.items[0].menuItemId, "dish-1");

const publicBill = sanitizeCustomerBillForPublicRead({
  bill: { itemsSnapshot: [{ menuItemId: "dish-1", reportedAllergies: ["NUTS"], allergenInfoStatus: "UNKNOWN", allergenWarnings: [], allergenContainsWarnings: [], allergenMayContainWarnings: [] }] },
  orders: [order],
  session: { id: "session-1" }
});
assert.equal(Object.prototype.hasOwnProperty.call(publicBill.bill.itemsSnapshot[0], "reportedAllergies"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicBill.bill.itemsSnapshot[0], "allergenInfoStatus"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicBill.bill.itemsSnapshot[0], "allergenWarnings"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicBill.bill.itemsSnapshot[0], "allergenContainsWarnings"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicBill.bill.itemsSnapshot[0], "allergenMayContainWarnings"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicBill.orders[0], "reportedAllergies"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicBill.orders[0].items[0], "allergenWarnings"), false);
assert.equal(publicBill.session.id, "session-1");

console.log("customer order serialization privacy tests passed");
