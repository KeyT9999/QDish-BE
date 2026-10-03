import "dotenv/config";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import mongoose from "mongoose";
import type { AddressInfo } from "node:net";

import { connectDB } from "../config/db.js";
import { Bill } from "../models/Bill.js";
import { MenuItem } from "../models/MenuItem.js";
import { Order } from "../models/Order.js";
import { OwnerRestaurantQuotaLease } from "../models/OwnerRestaurantQuotaLease.js";
import { Restaurant } from "../models/Restaurant.js";
import { Table } from "../models/Table.js";
import { TableSession } from "../models/TableSession.js";
import billRouter from "../routes/billRoutes.js";
import orderRouter from "../routes/orderRoutes.js";

async function run() {
  await connectDB();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ownerId = new mongoose.Types.ObjectId();
  const restaurant = await Restaurant.create({
    name: "Allergen route test",
    username: `allergen_${suffix}`,
    ownerName: "Allergen Test Owner",
    email: `allergen_${suffix}@example.test`,
    address: "Test address",
    phone: "0900000000",
    ownerId
  });
  const otherRestaurant = await Restaurant.create({
    name: "Other allergen route test",
    username: `allergen_other_${suffix}`,
    ownerName: "Other Test Owner",
    email: `allergen_other_${suffix}@example.test`,
    address: "Other test address",
    phone: "0900000001",
    ownerId: new mongoose.Types.ObjectId()
  });
  const tableCode = `A${suffix}`;
  const sessionCode = `S${suffix}`;
  const table = await Table.create({ restaurantId: restaurant._id, code: tableCode, isActive: true });
  const session = await TableSession.create({
    restaurantId: restaurant._id,
    tableId: table._id,
    tableNumber: tableCode,
    sessionCode,
    openedAt: new Date(),
    totalAmount: 0,
    orderCount: 0
  });
  await Table.updateOne({ _id: table._id }, {
    $set: { activeSessionId: session._id, currentSessionCode: sessionCode }
  });

  const reviewedDish = await MenuItem.create({
    restaurantId: restaurant._id,
    name: "Reviewed nut dish",
    description: "",
    price: 100,
    category: "Test",
    imageUrl: "",
    allergens: ["nuts"],
    allergenInfoStatus: "REVIEWED"
  });
  const foreignDish = await MenuItem.create({
    restaurantId: otherRestaurant._id,
    name: "Foreign nut dish",
    description: "",
    price: 200,
    category: "Test",
    imageUrl: "",
    allergens: ["NUTS"],
    allergenInfoStatus: "REVIEWED"
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.requestId = `allergen-${suffix}`;
    next();
  });
  app.use("/api/orders", orderRouter);
  app.use("/api/bills", billRouter);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${address.port}/api/orders`;

  const createOrder = (input: Record<string, unknown>) => fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      restaurantId: restaurant._id.toString(),
      tableNumber: tableCode,
      tableSessionId: session._id.toString(),
      ...input
    })
  });

  try {
    const invalid = await createOrder({
      items: [{ menuItemId: reviewedDish._id.toString(), name: reviewedDish.name, price: 100, quantity: 1 }],
      reportedAllergies: ["NUTS", " nuts "]
    });
    assert.equal(invalid.status, 400, "duplicate normalized allergy codes are rejected");

    const reviewedResponse = await createOrder({
      items: [{
        menuItemId: reviewedDish._id.toString(),
        name: reviewedDish.name,
        price: 100,
        quantity: 1,
        allergens: ["FISH"],
        allergenInfoStatus: "UNKNOWN",
        allergenWarnings: ["FISH"]
      }],
      reportedAllergies: [" nuts "],
      note: "Ít cay giúp mình"
    });
    assert.equal(reviewedResponse.status, 201, "a declared conflict must not block ordering");
    const reviewedOrder = await reviewedResponse.json() as any;
    assert.equal(reviewedOrder.items[0].allergenInfoStatus, "REVIEWED");
    assert.deepEqual(reviewedOrder.items[0].allergenWarnings, ["NUTS"]);
    assert.equal(reviewedOrder.items[0].allergens, undefined, "client allergen arrays are not persisted");
    assert.equal(reviewedOrder.note, "Ít cay giúp mình", "customer notes remain separate");
    assert.equal(reviewedOrder.reportedAllergies, undefined, "the full profile is omitted when all items are reviewed");

    const foreignResponse = await createOrder({
      items: [{
        menuItemId: foreignDish._id.toString(),
        name: foreignDish.name,
        price: 200,
        quantity: 1,
        allergenInfoStatus: "REVIEWED",
        allergenWarnings: []
      }],
      reportedAllergies: ["NUTS"]
    });
    assert.equal(foreignResponse.status, 201, "unresolved menu metadata must remain orderable");
    const foreignOrder = await foreignResponse.json() as any;
    assert.equal(foreignOrder.items[0].allergenInfoStatus, "UNKNOWN", "another restaurant's allergen data is not trusted");
    assert.deepEqual(foreignOrder.items[0].allergenWarnings, []);
    assert.deepEqual(foreignOrder.reportedAllergies, ["NUTS"]);

    const secondDinerResponse = await createOrder({
      items: [{ menuItemId: foreignDish._id.toString(), name: foreignDish.name, price: 200, quantity: 1 }],
      reportedAllergies: ["FISH"]
    });
    assert.equal(secondDinerResponse.status, 201);
    const secondDinerOrder = await secondDinerResponse.json() as any;
    assert.deepEqual(secondDinerOrder.reportedAllergies, ["FISH"], "each order keeps its own allergy context");

    const bill = await Bill.findOne({ restaurantId: restaurant._id, tableSessionId: session._id });
    assert.ok(bill);
    assert.equal(bill.itemsSnapshot.length, 3, "bill aggregation preserves distinct warning contexts");
    assert.deepEqual(bill.itemsSnapshot.map((item) => item.allergenInfoStatus), ["REVIEWED", "UNKNOWN", "UNKNOWN"]);
    assert.deepEqual(bill.itemsSnapshot.map((item) => item.reportedAllergies), [undefined, ["NUTS"], ["FISH"]]);
    assert.equal(bill.itemsSnapshot[0].notes, "Ít cay giúp mình");

    const historyResponse = await fetch(`${endpoint}?restaurantId=${restaurant._id}&tableNumber=${tableCode}&sessionId=${session._id}`);
    assert.equal(historyResponse.status, 200);
    const publicOrders = await historyResponse.json() as any[];
    assert.equal(publicOrders.length, 3);
    assert.ok(publicOrders.every((order) => !Object.prototype.hasOwnProperty.call(order, "reportedAllergies")));
    assert.ok(publicOrders.every((order) => !Object.prototype.hasOwnProperty.call(order.items[0], "allergenInfoStatus")));
    assert.ok(publicOrders.every((order) => !Object.prototype.hasOwnProperty.call(order.items[0], "allergenWarnings")));

    const currentBillResponse = await fetch(`http://127.0.0.1:${address.port}/api/bills/current?restaurantId=${restaurant._id}&tableNumber=${tableCode}&sessionId=${session._id}`);
    assert.equal(currentBillResponse.status, 200);
    const publicCurrentBill = await currentBillResponse.json() as any;
    assert.ok(publicCurrentBill.bill.itemsSnapshot.every((item: any) => !Object.prototype.hasOwnProperty.call(item, "reportedAllergies")));
    assert.ok(publicCurrentBill.bill.itemsSnapshot.every((item: any) => !Object.prototype.hasOwnProperty.call(item, "allergenInfoStatus")));
    assert.ok(publicCurrentBill.orders.every((order: any) => !Object.prototype.hasOwnProperty.call(order, "reportedAllergies")));
    assert.ok(publicCurrentBill.orders.every((order: any) => !Object.prototype.hasOwnProperty.call(order.items[0], "allergenWarnings")));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await Order.deleteMany({ restaurantId: { $in: [restaurant._id, otherRestaurant._id] } });
    await Bill.deleteMany({ restaurantId: { $in: [restaurant._id, otherRestaurant._id] } });
    await TableSession.deleteMany({ restaurantId: { $in: [restaurant._id, otherRestaurant._id] } });
    await Table.deleteMany({ restaurantId: { $in: [restaurant._id, otherRestaurant._id] } });
    await MenuItem.deleteMany({ restaurantId: { $in: [restaurant._id, otherRestaurant._id] } });
    await OwnerRestaurantQuotaLease.deleteOne({ _id: ownerId });
    await Restaurant.deleteMany({ _id: { $in: [restaurant._id, otherRestaurant._id] } });
    await mongoose.disconnect();
  }

  console.log("order allergen order route tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
