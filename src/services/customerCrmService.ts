import mongoose from "mongoose";

import { Order } from "../models/Order.js";
import { RestaurantCustomer } from "../models/RestaurantCustomer.js";
import { TableSession } from "../models/TableSession.js";
import { maskPhone, revealPhone } from "./customerIdentityService.js";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface ListCustomersInput {
  restaurantId: string;
  page: number;
  limit: number;
  search?: string;
}

export async function listCustomers(input: ListCustomersInput) {
  const restaurantObjectId = new mongoose.Types.ObjectId(input.restaurantId);
  const filter: Record<string, unknown> = { restaurantId: restaurantObjectId };
  const search = input.search?.trim().slice(0, 100);

  if (search) {
    const digits = search.replace(/\D/g, "");
    filter.$or = [
      { displayName: { $regex: escapeRegex(search), $options: "i" } },
      ...(digits.length >= 4 ? [{ phoneLast4: digits.slice(-4) }] : [])
    ];
  }

  const skip = (input.page - 1) * input.limit;
  const [customers, totalItems] = await Promise.all([
    RestaurantCustomer.find(filter)
      .sort({ lastSeenAt: -1 })
      .skip(skip)
      .limit(input.limit)
      .lean(),
    RestaurantCustomer.countDocuments(filter)
  ]);

  return {
    data: customers.map((customer) => ({
      id: customer._id.toString(),
      displayName: customer.displayName,
      maskedPhone: maskPhone(customer.phoneLast4),
      marketingConsent: customer.marketingConsent,
      firstSeenAt: customer.firstSeenAt,
      lastSeenAt: customer.lastSeenAt,
      visitCount: customer.visitCount,
      orderCount: customer.orderCount,
      totalSpend: customer.totalSpend
    })),
    pagination: {
      page: input.page,
      limit: input.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / input.limit)
    }
  };
}

interface GetCustomerDetailInput {
  restaurantId: string;
  customerId: string;
  page: number;
  limit: number;
  secret?: string;
}

export async function getCustomerDetail(input: GetCustomerDetailInput) {
  const restaurantObjectId = new mongoose.Types.ObjectId(input.restaurantId);
  const customer = await RestaurantCustomer.findOne({
    _id: new mongoose.Types.ObjectId(input.customerId),
    restaurantId: restaurantObjectId
  }).select("+phoneCiphertext").lean();

  if (!customer) return null;

  const sessionFilter = {
    restaurantId: restaurantObjectId,
    customerId: customer._id
  };
  const skip = (input.page - 1) * input.limit;
  const [sessions, totalVisits] = await Promise.all([
    TableSession.find(sessionFilter)
      .sort({ openedAt: -1 })
      .skip(skip)
      .limit(input.limit)
      .lean(),
    TableSession.countDocuments(sessionFilter)
  ]);
  const sessionIds = sessions.map((session) => session._id);
  const orders = sessionIds.length > 0
    ? await Order.find({
        restaurantId: restaurantObjectId,
        tableSessionId: { $in: sessionIds }
      }).sort({ createdAt: -1 }).lean()
    : [];

  const ordersBySession = new Map<string, typeof orders>();
  for (const order of orders) {
    const key = order.tableSessionId?.toString();
    if (!key) continue;
    const grouped = ordersBySession.get(key) || [];
    grouped.push(order);
    ordersBySession.set(key, grouped);
  }

  return {
    customer: {
      id: customer._id.toString(),
      displayName: customer.displayName,
      phone: revealPhone(
        customer.phoneCiphertext,
        input.secret ?? process.env.CUSTOMER_PII_KEY ?? ""
      ),
      marketingConsent: customer.marketingConsent,
      consentAt: customer.consentAt,
      firstSeenAt: customer.firstSeenAt,
      lastSeenAt: customer.lastSeenAt,
      visitCount: customer.visitCount,
      orderCount: customer.orderCount,
      totalSpend: customer.totalSpend
    },
    visits: sessions.map((session) => ({
      id: session._id.toString(),
      tableNumber: session.tableNumber,
      sessionCode: session.sessionCode,
      status: session.status,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      totalAmount: session.totalAmount,
      orders: (ordersBySession.get(session._id.toString()) || []).map((order) => ({
        id: order._id.toString(),
        items: order.items,
        totalAmount: order.totalAmount,
        status: order.status,
        note: order.note,
        createdAt: order.createdAt
      }))
    })),
    pagination: {
      page: input.page,
      limit: input.limit,
      totalItems: totalVisits,
      totalPages: Math.ceil(totalVisits / input.limit)
    }
  };
}
