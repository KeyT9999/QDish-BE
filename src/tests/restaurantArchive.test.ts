import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import { Restaurant, RestaurantStatus } from "../models/Restaurant.js";
import { TableSessionStatus } from "../models/TableSession.js";
import { BillStatus } from "../models/Bill.js";
import { Table } from "../models/Table.js";
import { MenuItem } from "../models/MenuItem.js";
import { User } from "../models/User.js";
import { TableSession } from "../models/TableSession.js";
import { getOwnerUsage } from "../services/subscriptionService.js";
import { createRestaurantArchiveService } from "../services/restaurantArchiveService.js";
import { ownerRestaurantListFilter } from "../routes/ownerRestaurantRoutes.js";
import ownerRestaurantRouter from "../routes/ownerRestaurantRoutes.js";
import { Subscription } from "../models/Subscription.js";
import { Plan } from "../models/Plan.js";

const ownerId = "507f1f77bcf86cd799439011";
const otherOwnerId = "507f1f77bcf86cd799439012";
const restaurantId = "507f1f77bcf86cd799439013";
const archivedId = "507f1f77bcf86cd799439014";

type Branch = {
  _id: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  status: RestaurantStatus;
  active: boolean;
  archivedAt?: Date;
  archivedByOwnerId?: mongoose.Types.ObjectId;
};

function fixture(options: { sessions?: string[]; bills?: string[]; quota?: boolean; countFails?: boolean } = {}) {
  const branch: Branch = {
    _id: new mongoose.Types.ObjectId(restaurantId),
    ownerId: new mongoose.Types.ObjectId(ownerId),
    status: RestaurantStatus.INACTIVE,
    active: false
  };
  const linked = { orders: ["order-1"], bills: ["bill-1"], tables: ["table-1"], menu: ["dish-1"], staff: ["staff-1"] };
  const linkedBefore = structuredClone(linked);
  const filters: any[] = [];
  const updates: any[] = [];
  let writes = 0;
  const matches = (filter: any) => {
    if (filter._id?.toString() !== restaurantId || filter.ownerId?.toString() !== ownerId) return false;
    if (filter.archivedAt === null && branch.archivedAt) return false;
    if (filter.archivedAt?.$ne === null && !branch.archivedAt) return false;
    return true;
  };
  const service = createRestaurantArchiveService({
    Restaurant: {
      findOne: async (filter: any) => {
        filters.push(filter);
        return matches(filter) ? { ...branch } : null;
      },
      findOneAndUpdate: async (filter: any, update: any) => {
        filters.push(filter);
        if (!matches(filter)) return null;
        writes++;
        updates.push(update);
        if (update.$set) Object.assign(branch, update.$set);
        if (update.$unset) for (const key of Object.keys(update.$unset)) delete (branch as any)[key];
        return { ...branch };
      }
    },
    TableSession: {
      countDocuments: async (filter: any) => {
        if (options.countFails) throw new Error("count failed");
        assert.equal(filter.restaurantId?.toString(), restaurantId);
        assert.deepEqual(filter.status.$in, [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_REQUESTED]);
        return (options.sessions || []).filter(status => filter.status.$in.includes(status)).length;
      }
    },
    Bill: {
      countDocuments: async (filter: any) => {
        assert.equal(filter.restaurantId?.toString(), restaurantId);
        assert.deepEqual(filter.status.$in, [BillStatus.UNPAID, BillStatus.PAYMENT_REQUESTED]);
        return (options.bills || []).filter(status => filter.status.$in.includes(status)).length;
      }
    },
    checkPlanLimit: async (_ownerId: string, type: string) => {
      assert.equal(type, "RESTAURANT_LIMIT");
      return options.quota ? { message: "Plan full", currentPlan: "FREE", limitValue: 1, currentUsage: 1 } : null;
    }
  } as any);
  return { branch, linked, linkedBefore, filters, updates, service, get writes() { return writes; } };
}

async function run() {
  {
    const f = fixture();
    await assert.rejects(f.service.archive(otherOwnerId, restaurantId), (error: any) => error.statusCode === 404);
    await assert.rejects(f.service.restore(otherOwnerId, restaurantId), (error: any) => error.statusCode === 404);
    assert.equal(f.writes, 0);
  }
  {
    const f = fixture();
    await assert.rejects(f.service.archive(ownerId, archivedId), (error: any) => error.statusCode === 404);
    assert.equal(f.writes, 0);
  }
  for (const status of [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_REQUESTED]) {
    const f = fixture({ sessions: [status, TableSessionStatus.CLOSED] });
    await assert.rejects(f.service.archive(ownerId, restaurantId), (error: any) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "RESTAURANT_HAS_OPEN_ACTIVITY");
      assert.equal(error.activeSessions, 1);
      assert.equal(error.unpaidBills, 0);
      return true;
    });
    assert.equal(f.writes, 0);
  }
  for (const status of [BillStatus.UNPAID, BillStatus.PAYMENT_REQUESTED]) {
    const f = fixture({ bills: [status, BillStatus.PAID] });
    await assert.rejects(f.service.archive(ownerId, restaurantId), (error: any) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "RESTAURANT_HAS_OPEN_ACTIVITY");
      assert.equal(error.activeSessions, 0);
      assert.equal(error.unpaidBills, 1);
      return true;
    });
    assert.equal(f.writes, 0);
  }
  {
    const f = fixture({ countFails: true });
    await assert.rejects(f.service.archive(ownerId, restaurantId), /count failed/);
    assert.equal(f.branch.archivedAt, undefined);
    assert.equal(f.writes, 0);
  }
  {
    const f = fixture();
    const archived = await f.service.archive(ownerId, restaurantId);
    assert.equal(archived.restaurantId, restaurantId);
    assert.ok(archived.archivedAt instanceof Date);
    assert.equal(f.branch.archivedByOwnerId?.toString(), ownerId);
    assert.equal(f.branch.status, RestaurantStatus.INACTIVE);
    assert.equal(f.branch.active, false);
    assert.deepEqual(f.linked, f.linkedBefore);
    const again = await f.service.archive(ownerId, restaurantId);
    assert.equal(again.archivedAt.getTime(), archived.archivedAt.getTime());
    assert.equal(f.writes, 1);
    const restored = await f.service.restore(ownerId, restaurantId);
    assert.equal(restored.status, RestaurantStatus.INACTIVE);
    assert.equal(restored.active, false);
    assert.equal(restored.archivedAt, undefined);
    assert.equal(restored.archivedByOwnerId, undefined);
    assert.deepEqual(f.linked, f.linkedBefore);
    assert.equal(f.writes, 2);
    assert.deepEqual(Object.keys(f.updates[0]), ["$set"]);
    assert.deepEqual(Object.keys(f.updates[0].$set).sort(), ["archivedAt", "archivedByOwnerId"]);
    assert.deepEqual(Object.keys(f.updates[1].$unset).sort(), ["archivedAt", "archivedByOwnerId"]);
    assert.ok(f.filters.some(filter => filter.archivedAt === null));
    assert.ok(f.filters.some(filter => filter.archivedAt?.$ne === null));
  }
  {
    const f = fixture({ quota: true });
    await f.service.archive(ownerId, restaurantId);
    await assert.rejects(f.service.restore(ownerId, restaurantId), (error: any) => {
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, "PLAN_LIMIT_REACHED");
      assert.equal(error.limitType, "RESTAURANT_LIMIT");
      assert.equal(error.currentPlan, "FREE");
      assert.equal(error.limitValue, 1);
      assert.equal(error.currentUsage, 1);
      return true;
    });
    assert.ok(f.branch.archivedAt);
    assert.equal(f.writes, 1);
  }
  {
    const active = ownerRestaurantListFilter(ownerId, undefined);
    const archived = ownerRestaurantListFilter(ownerId, "true");
    assert.equal(active.ownerId.toString(), ownerId);
    assert.equal(active.archivedAt, null);
    assert.deepEqual(archived.archivedAt, { $ne: null });
  }
  {
    const saved = {
      findOne: Restaurant.findOne,
      find: Restaurant.find,
      restaurantCount: Restaurant.countDocuments,
      update: Restaurant.findOneAndUpdate,
      tableCount: Table.countDocuments,
      menuCount: MenuItem.countDocuments,
      staffCount: User.countDocuments,
      sessionCount: TableSession.countDocuments,
      billCount: (await import("../models/Bill.js")).Bill.countDocuments,
      subscriptionFind: Subscription.findOne,
      planFind: Plan.findById,
      orderFind: (await import("../models/Order.js")).Order.find
    };
    const { Bill } = await import("../models/Bill.js");
    const { Order } = await import("../models/Order.js");
    const branch = { _id: new mongoose.Types.ObjectId(restaurantId), ownerId: new mongoose.Types.ObjectId(ownerId),
      status: RestaurantStatus.INACTIVE, active: false, archivedAt: undefined as Date | undefined,
      toObject() { return { _id: this._id, ownerId: this.ownerId, status: this.status, active: this.active, archivedAt: this.archivedAt }; } };
    const listFilters: any[] = [];
    try {
      (Restaurant.findOne as any) = async (filter: any) => filter._id?.toString() === restaurantId && filter.ownerId?.toString() === ownerId ? branch : null;
      (Restaurant.findOneAndUpdate as any) = async (filter: any, update: any) => {
        if (filter._id.toString() !== restaurantId || filter.ownerId.toString() !== ownerId) return null;
        if (filter.archivedAt === null && branch.archivedAt) return null;
        if (filter.archivedAt?.$ne === null && !branch.archivedAt) return null;
        if (update.$set) branch.archivedAt = update.$set.archivedAt;
        if (update.$unset) branch.archivedAt = undefined;
        return branch;
      };
      (Restaurant.find as any) = (filter: any) => {
        listFilters.push(filter);
        return {
          sort: async () => filter.archivedAt === null && !branch.archivedAt || filter.archivedAt?.$ne === null && !!branch.archivedAt ? [branch] : [],
          select: async () => [{ _id: branch._id }]
        };
      };
      (Restaurant.countDocuments as any) = async () => branch.archivedAt ? 0 : 1;
      (Table.countDocuments as any) = async () => 0;
      (MenuItem.countDocuments as any) = async () => 0;
      (User.countDocuments as any) = async () => 0;
      (TableSession.countDocuments as any) = async () => 0;
      (Bill.countDocuments as any) = async () => 0;
      (Subscription.findOne as any) = async () => ({ planId: new mongoose.Types.ObjectId(), planCode: "FREE" });
      (Plan.findById as any) = async () => ({ code: "FREE", restaurantLimit: 3 });
      (Order.find as any) = async () => [];
      const app = express();
      app.use(express.json());
      app.use("/api/owner/restaurants", ownerRestaurantRouter);
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>(resolve => server.once("listening", resolve));
      try {
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const base = `http://127.0.0.1:${address.port}/api/owner/restaurants`;
        const request = async (method: string, path: string, sub = ownerId, role = "RESTAURANT_OWNER") =>
          fetch(base + path, { method, headers: { authorization: `Bearer ${jwt.sign({ sub, role }, process.env.JWT_SECRET || "change-me")}` } });
        assert.equal((await (await request("GET", "/")).json() as any[]).length, 1);
        assert.equal((await (await request("GET", "/?archived=true")).json() as any[]).length, 0);
        const deniedRole = await request("DELETE", `/${restaurantId}`, ownerId, "STAFF");
        assert.equal(deniedRole.status, 403);
        const wrongOwner = await request("DELETE", `/${restaurantId}`, otherOwnerId);
        assert.equal(wrongOwner.status, 404);
        (TableSession.countDocuments as any) = async () => 1;
        const conflict = await request("DELETE", `/${restaurantId}`);
        assert.equal(conflict.status, 409);
        assert.deepEqual(await conflict.json(), {
          message: "Đóng các phiên bàn và thanh toán hết hóa đơn trước khi lưu trữ chi nhánh.",
          code: "RESTAURANT_HAS_OPEN_ACTIVITY", activeSessions: 1, unpaidBills: 0
        });
        assert.equal(branch.archivedAt, undefined);
        (TableSession.countDocuments as any) = async () => 0;
        const archived = await request("DELETE", `/${restaurantId}`);
        assert.equal(archived.status, 200);
        assert.deepEqual(Object.keys(await archived.json()), ["restaurantId", "archivedAt"]);
        assert.equal((await (await request("GET", "/")).json() as any[]).length, 0);
        assert.equal((await (await request("GET", "/?archived=true")).json() as any[]).length, 1);
        assert.equal((await request("POST", `/${restaurantId}/restore`, otherOwnerId)).status, 404);
        const restored = await request("POST", `/${restaurantId}/restore`);
        assert.equal(restored.status, 200);
        assert.equal((await restored.json() as any).archivedAt, undefined);
        assert.equal(branch.status, RestaurantStatus.INACTIVE);
        assert.equal(branch.active, false);
        assert.ok(listFilters.every(filter => filter.ownerId.toString() === ownerId));
      } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    } finally {
      Restaurant.findOne = saved.findOne;
      Restaurant.find = saved.find;
      Restaurant.countDocuments = saved.restaurantCount;
      Restaurant.findOneAndUpdate = saved.update;
      Table.countDocuments = saved.tableCount;
      MenuItem.countDocuments = saved.menuCount;
      User.countDocuments = saved.staffCount;
      TableSession.countDocuments = saved.sessionCount;
      Bill.countDocuments = saved.billCount;
      Subscription.findOne = saved.subscriptionFind;
      Plan.findById = saved.planFind;
      Order.find = saved.orderFind;
    }
  }
  {
    const saved = {
      restaurantCount: Restaurant.countDocuments,
      restaurantFind: Restaurant.find,
      tableCount: Table.countDocuments,
      menuCount: MenuItem.countDocuments,
      staffCount: User.countDocuments,
      scanCount: TableSession.countDocuments
    };
    try {
      (Restaurant.countDocuments as any) = async (filter: any) => {
        assert.equal(filter.ownerId.toString(), ownerId);
        assert.equal(filter.archivedAt, null);
        return 1;
      };
      (Restaurant.find as any) = (filter: any) => ({ select: async () => {
        assert.equal(filter.ownerId.toString(), ownerId);
        return [{ _id: new mongoose.Types.ObjectId(restaurantId) }, { _id: new mongoose.Types.ObjectId(archivedId) }];
      } });
      const countResources = async (filter: any) => {
        assert.deepEqual(filter.restaurantId.$in.map((id: any) => id.toString()), [restaurantId, archivedId]);
        return 2;
      };
      (Table.countDocuments as any) = countResources;
      (MenuItem.countDocuments as any) = countResources;
      (User.countDocuments as any) = countResources;
      (TableSession.countDocuments as any) = countResources;
      const usage = await getOwnerUsage(ownerId);
      assert.deepEqual(usage, { restaurantCount: 1, tableCount: 2, menuItemCount: 2, staffCount: 2, scanCount: 2 });
    } finally {
      Restaurant.countDocuments = saved.restaurantCount;
      Restaurant.find = saved.restaurantFind;
      Table.countDocuments = saved.tableCount;
      MenuItem.countDocuments = saved.menuCount;
      User.countDocuments = saved.staffCount;
      TableSession.countDocuments = saved.scanCount;
    }
  }
  console.log("restaurant archive tests passed");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
