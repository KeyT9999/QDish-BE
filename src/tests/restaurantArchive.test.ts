import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
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
import authRouter from "../routes/authRoutes.js";
import restaurantRouter from "../routes/restaurantRoutes.js";
import orderRouter from "../routes/orderRoutes.js";
import tableSessionRouter from "../routes/tableSessionRoutes.js";
import { requireAuth } from "../middleware/auth.js";
import { Subscription } from "../models/Subscription.js";
import { Plan } from "../models/Plan.js";
import { OwnerRestaurantQuotaLease } from "../models/OwnerRestaurantQuotaLease.js";
import { OwnerRestaurantQuotaLeaseError } from "../services/ownerRestaurantQuotaLeaseService.js";

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
  archiveTransitionId?: string;
  archiveTransitionExpiresAt?: Date;
};

function fixture(options: { sessions?: string[]; bills?: string[]; quota?: boolean; countFails?: boolean; requireBarrier?: boolean } = {}) {
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
  let staffSocketsDisconnected = 0;
  const matches = (filter: any) => {
    if (filter._id?.toString() !== restaurantId || filter.ownerId?.toString() !== ownerId) return false;
    if (filter.archivedAt === null && branch.archivedAt) return false;
    if (filter.archivedAt?.$ne === null && !branch.archivedAt) return false;
    if (filter.archivedAt instanceof Date && filter.archivedAt.getTime() !== branch.archivedAt?.getTime()) return false;
    if (filter.archiveTransitionId && filter.archiveTransitionId !== branch.archiveTransitionId) return false;
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
        if (options.requireBarrier) assert.ok(branch.archivedAt, "archive marker must precede activity count");
        if (options.countFails) throw new Error("count failed");
        assert.equal(filter.restaurantId?.toString(), restaurantId);
        assert.deepEqual(filter.status.$in, [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_REQUESTED]);
        return (options.sessions || []).filter(status => filter.status.$in.includes(status)).length;
      }
    },
    Bill: {
      countDocuments: async (filter: any) => {
        if (options.requireBarrier) assert.ok(branch.archivedAt, "archive marker must precede bill count");
        assert.equal(filter.restaurantId?.toString(), restaurantId);
        assert.deepEqual(filter.status.$in, [BillStatus.UNPAID, BillStatus.PAYMENT_REQUESTED]);
        return (options.bills || []).filter(status => filter.status.$in.includes(status)).length;
      }
    },
    checkPlanLimit: async (_ownerId: string, type: string) => {
      assert.equal(type, "RESTAURANT_LIMIT");
      return options.quota ? { message: "Plan full", currentPlan: "FREE", limitValue: 1, currentUsage: 1 } : null;
    },
    withQuotaLease: async (_ownerId: string, work: any) => work({
      assertHeld: async () => {},
      reserveRestaurantSlot: async () => ({ release: async () => {} })
    }),
    disconnectStaffSockets: async (id: string) => {
      assert.equal(id, restaurantId);
      staffSocketsDisconnected++;
    }
  } as any);
  return { branch, linked, linkedBefore, filters, updates, service, get writes() { return writes; }, get staffSocketsDisconnected() { return staffSocketsDisconnected; } };
}

async function run() {
  {
    const f = fixture();
    await assert.rejects(f.service.archive(otherOwnerId, restaurantId), (error: any) => error.statusCode === 404);
    await assert.rejects(f.service.restore(otherOwnerId, restaurantId), (error: any) => error.statusCode === 404);
    assert.equal(f.writes, 0);
    assert.equal(f.branch.archivedAt, undefined);
  }
  {
    const f = fixture();
    await assert.rejects(f.service.archive(ownerId, archivedId), (error: any) => error.statusCode === 404);
    assert.equal(f.writes, 0);
    assert.equal(f.branch.archivedAt, undefined);
  }
  for (const status of [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_REQUESTED]) {
    const f = fixture({ sessions: [status, TableSessionStatus.CLOSED], requireBarrier: true });
    await assert.rejects(f.service.archive(ownerId, restaurantId), (error: any) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "RESTAURANT_HAS_OPEN_ACTIVITY");
      assert.equal(error.activeSessions, 1);
      assert.equal(error.unpaidBills, 0);
      return true;
    });
    assert.equal(f.writes, 2);
    assert.equal(f.branch.archivedAt, undefined);
    assert.ok(f.filters.some(filter => filter.archivedAt instanceof Date && typeof filter.archiveTransitionId === "string"));
  }
  for (const status of [BillStatus.UNPAID, BillStatus.PAYMENT_REQUESTED]) {
    const f = fixture({ bills: [status, BillStatus.PAID], requireBarrier: true });
    await assert.rejects(f.service.archive(ownerId, restaurantId), (error: any) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "RESTAURANT_HAS_OPEN_ACTIVITY");
      assert.equal(error.activeSessions, 0);
      assert.equal(error.unpaidBills, 1);
      return true;
    });
    assert.equal(f.writes, 2);
    assert.equal(f.branch.archivedAt, undefined);
  }
  {
    const f = fixture({ countFails: true, requireBarrier: true });
    await assert.rejects(f.service.archive(ownerId, restaurantId), /count failed/);
    assert.equal(f.branch.archivedAt, undefined);
  }
  {
    const f = fixture({ requireBarrier: true });
    await f.service.archive(ownerId, restaurantId);
    assert.ok(f.branch.archivedAt);
    assert.equal(f.staffSocketsDisconnected, 1, "staff/admin realtime connections are revoked after archive finalizes");
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
    assert.equal(f.writes, 2);
    const restored = await f.service.restore(ownerId, restaurantId);
    assert.equal(restored.status, RestaurantStatus.INACTIVE);
    assert.equal(restored.active, false);
    assert.equal(restored.archivedAt, undefined);
    assert.equal(restored.archivedByOwnerId, undefined);
    assert.deepEqual(f.linked, f.linkedBefore);
    assert.equal(f.writes, 3);
    assert.deepEqual(Object.keys(f.updates[0]), ["$set"]);
    assert.deepEqual(Object.keys(f.updates[0].$set).sort(), ["archiveTransitionExpiresAt", "archiveTransitionId", "archivedAt", "archivedByOwnerId"]);
    assert.deepEqual(Object.keys(f.updates[1].$unset).sort(), ["archiveTransitionExpiresAt", "archiveTransitionId"]);
    assert.deepEqual(Object.keys(f.updates[2].$unset).sort(), ["archivedAt", "archivedByOwnerId"]);
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
    assert.equal(f.writes, 2);
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
      findById: Restaurant.findById,
      find: Restaurant.find,
      restaurantCount: Restaurant.countDocuments,
      update: Restaurant.findOneAndUpdate,
      restaurantCreate: Restaurant.create,
      tableCount: Table.countDocuments,
      menuCount: MenuItem.countDocuments,
      staffCount: User.countDocuments,
      userFindOne: User.findOne,
      userFindById: User.findById,
      userCreate: User.create,
      sessionCount: TableSession.countDocuments,
      billCount: (await import("../models/Bill.js")).Bill.countDocuments,
      subscriptionFind: Subscription.findOne,
      planFind: Plan.findById,
      leaseUpdate: OwnerRestaurantQuotaLease.findOneAndUpdate,
      leaseExists: OwnerRestaurantQuotaLease.exists,
      leaseDelete: OwnerRestaurantQuotaLease.deleteOne,
      leaseUpdateOne: OwnerRestaurantQuotaLease.updateOne,
      leaseCount: OwnerRestaurantQuotaLease.countDocuments,
      orderFind: (await import("../models/Order.js")).Order.find
    };
    const { Bill } = await import("../models/Bill.js");
    const { Order } = await import("../models/Order.js");
    const branch = { _id: new mongoose.Types.ObjectId(restaurantId), ownerId: new mongoose.Types.ObjectId(ownerId),
      status: RestaurantStatus.INACTIVE, active: false, archivedAt: undefined as Date | undefined,
      archiveTransitionId: undefined as string | undefined,
      toObject() { return { _id: this._id, ownerId: this.ownerId, status: this.status, active: this.active, archivedAt: this.archivedAt }; } };
    const listFilters: any[] = [];
    let quotaLease: { token?: string; expiresAt?: Date; reservationToken?: string; reservationExpiresAt?: Date } | null = null;
    let archiveLeaseFails = false;
    let createdWhileLeased = false;
    try {
      (Restaurant.findOne as any) = async (filter: any) => filter._id?.toString() === restaurantId && filter.ownerId?.toString() === ownerId ? branch : null;
      (Restaurant.findById as any) = (id: any) => {
        const document = id?.toString() === restaurantId ? branch : null;
        return {
          select: async () => document,
          then: (resolve: any, reject: any) => Promise.resolve(document).then(resolve, reject)
        };
      };
      (Restaurant.findOneAndUpdate as any) = async (filter: any, update: any) => {
        if (filter._id.toString() !== restaurantId || filter.ownerId.toString() !== ownerId) return null;
        if (filter.archivedAt === null && branch.archivedAt) return null;
        if (filter.archivedAt?.$ne === null && !branch.archivedAt) return null;
        if (filter.archivedAt instanceof Date && filter.archivedAt.getTime() !== branch.archivedAt?.getTime()) return null;
        if (filter.archiveTransitionId && filter.archiveTransitionId !== branch.archiveTransitionId) return null;
        if (update.$set) Object.assign(branch, update.$set);
        if (update.$unset) for (const key of Object.keys(update.$unset)) delete (branch as any)[key];
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
      (User.findOne as any) = async () => null;
      (User.findById as any) = async () => ({ fullName: "Owner" });
      (User.create as any) = async () => ({ _id: new mongoose.Types.ObjectId(), username: "branch-new", role: "RESTAURANT_ADMIN" });
      (Restaurant.create as any) = async (data: any) => {
        createdWhileLeased = !!quotaLease?.token;
        return { _id: new mongoose.Types.ObjectId(), ...data };
      };
      (TableSession.countDocuments as any) = async () => 0;
      (Bill.countDocuments as any) = async () => 0;
      (Subscription.findOne as any) = async () => ({ planId: new mongoose.Types.ObjectId(), planCode: "FREE" });
      (Plan.findById as any) = async () => ({ code: "FREE", restaurantLimit: 3 });
      (OwnerRestaurantQuotaLease.findOneAndUpdate as any) = async (filter: any, update: any) => {
        if (archiveLeaseFails) throw new OwnerRestaurantQuotaLeaseError("Restaurant quota is busy; please retry");
        const now = new Date();
        if (filter.token && quotaLease?.token !== filter.token) return null;
        if (filter.reservationToken && quotaLease?.reservationToken !== filter.reservationToken) return null;
        if (filter.expiresAt?.$gt && (!quotaLease?.expiresAt || quotaLease.expiresAt <= now)) return null;
        if (filter.reservationExpiresAt?.$gt && (!quotaLease?.reservationExpiresAt || quotaLease.reservationExpiresAt <= now)) return null;
        if (update.$set?.token && quotaLease?.expiresAt && quotaLease.expiresAt > now) return null;
        if (update.$set?.reservationToken && quotaLease?.reservationExpiresAt && quotaLease.reservationExpiresAt > now) return null;
        quotaLease ||= {};
        Object.assign(quotaLease, update.$set);
        return quotaLease;
      };
      (OwnerRestaurantQuotaLease.exists as any) = async (filter: any) =>
        !!quotaLease && (filter.token
          ? quotaLease.token === filter.token && !!quotaLease.expiresAt && quotaLease.expiresAt > new Date()
          : quotaLease.reservationToken === filter.reservationToken && !!quotaLease.reservationExpiresAt && quotaLease.reservationExpiresAt > new Date());
      (OwnerRestaurantQuotaLease.deleteOne as any) = async (filter: any) => {
        if (quotaLease?.token === filter.token) quotaLease = null;
      };
      (OwnerRestaurantQuotaLease.updateOne as any) = async (filter: any, update: any) => {
        if (!quotaLease) return { modifiedCount: 0 };
        if (filter.token && quotaLease.token !== filter.token) return { modifiedCount: 0 };
        if (filter.reservationToken && quotaLease.reservationToken !== filter.reservationToken) return { modifiedCount: 0 };
        for (const key of Object.keys(update.$unset || {})) delete (quotaLease as any)[key];
        return { modifiedCount: 1 };
      };
      (OwnerRestaurantQuotaLease.countDocuments as any) = async (filter: any) =>
        !!quotaLease?.reservationExpiresAt && quotaLease.reservationExpiresAt > filter.reservationExpiresAt.$gt ? 1 : 0;
      (Order.find as any) = async () => [];
      const app = express();
      app.use(express.json());
      app.get("/api/auth-check", requireAuth, (_req, res) => res.json({ ok: true }));
      app.use("/api/owner/restaurants", ownerRestaurantRouter);
      app.use("/api/auth", authRouter);
      app.use("/api/restaurants", restaurantRouter);
      app.use("/api/orders", orderRouter);
      app.use("/api/table-sessions", tableSessionRouter);
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
        const wrongOwnerWithSelection = await fetch(base + `/${restaurantId}`, {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${jwt.sign({ sub: otherOwnerId, role: "RESTAURANT_OWNER" }, process.env.JWT_SECRET || "change-me")}`,
            "x-restaurant-id": restaurantId
          }
        });
        assert.equal(wrongOwnerWithSelection.status, 404);
        const wrongOwnerRestoreWithSelection = await fetch(base + `/${restaurantId}/restore`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${jwt.sign({ sub: otherOwnerId, role: "RESTAURANT_OWNER" }, process.env.JWT_SECRET || "change-me")}`,
            "x-restaurant-id": restaurantId
          }
        });
        assert.equal(wrongOwnerRestoreWithSelection.status, 404);
        const otherEndpointWithSelection = await fetch(base + `/${restaurantId}`, {
          headers: {
            authorization: `Bearer ${jwt.sign({ sub: otherOwnerId, role: "RESTAURANT_OWNER" }, process.env.JWT_SECRET || "change-me")}`,
            "x-restaurant-id": restaurantId
          }
        });
        assert.equal(otherEndpointWithSelection.status, 403);
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
        const archivedBody = await archived.json() as any;
        assert.equal(archived.status, 200, JSON.stringify(archivedBody));
        assert.deepEqual(Object.keys(archivedBody), ["restaurantId", "archivedAt"]);
        assert.equal((await (await request("GET", "/")).json() as any[]).length, 0);
        assert.equal((await (await request("GET", "/?archived=true")).json() as any[]).length, 1);
        branch.status = RestaurantStatus.ACTIVE;
        branch.active = true;
        const origin = `http://127.0.0.1:${address.port}`;
        const ownerToken = jwt.sign({ sub: ownerId, role: "RESTAURANT_OWNER" }, process.env.JWT_SECRET || "change-me");
        const selectedBranchHeaders = { authorization: `Bearer ${ownerToken}`, "x-restaurant-id": restaurantId };
        const selectedArchiveList = await fetch(`${base}/?archived=true`, { headers: selectedBranchHeaders });
        assert.equal(selectedArchiveList.status, 200, "owners must still be able to open the archive list with an archived branch selected");
        const blockedOwnerBranchRequest = await fetch(`${origin}/api/auth-check`, { headers: selectedBranchHeaders });
        assert.equal(blockedOwnerBranchRequest.status, 403);
        assert.equal((await blockedOwnerBranchRequest.json() as any).code, "RESTAURANT_ARCHIVED");
        for (const role of ["RESTAURANT_ADMIN", "STAFF"]) {
          const token = jwt.sign({ sub: otherOwnerId, role, restaurantId }, process.env.JWT_SECRET || "change-me");
          const blockedStaffRequest = await fetch(`${origin}/api/auth-check`, { headers: { authorization: `Bearer ${token}` } });
          assert.equal(blockedStaffRequest.status, 403, `archived ${role} JWTs must be rejected`);
          assert.equal((await blockedStaffRequest.json() as any).code, "RESTAURANT_ARCHIVED");
        }
        const archivedPublicRestaurant = await fetch(`${origin}/api/restaurants/public/${restaurantId}`);
        assert.equal(archivedPublicRestaurant.status, 404, "archived branches must not resolve publicly");
        const archivedSession = await fetch(`${origin}/api/table-sessions/resolve`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ restaurantId, tableNumber: "1" })
        });
        assert.equal(archivedSession.status, 404, "archived branches must not open customer sessions");
        const archivedOrder = await fetch(`${origin}/api/orders`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ restaurantId, tableNumber: "1", items: [{ menuItemId: "dish", name: "Dish", price: 100, quantity: 1 }] })
        });
        assert.equal(archivedOrder.status, 404, "archived branches must reject new orders");
        const adminPasswordHash = await bcrypt.hash("secret1", 4);
        (User.findOne as any) = async (filter: any) => filter.username === "branch-admin" ? {
          _id: new mongoose.Types.ObjectId(), username: "branch-admin", passwordHash: adminPasswordHash,
          role: "RESTAURANT_ADMIN", restaurantId: new mongoose.Types.ObjectId(restaurantId), isActive: true
        } : null;
        const archivedLogin = await fetch(`${origin}/api/auth/login`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: "branch-admin", password: "secret1" })
        });
        assert.equal(archivedLogin.status, 403, "archived branch admins must not receive new JWTs");
        assert.equal((await archivedLogin.json() as any).code, "RESTAURANT_ARCHIVED");
        assert.equal((await request("POST", `/${restaurantId}/restore`, otherOwnerId)).status, 404);
        const restored = await request("POST", `/${restaurantId}/restore`);
        assert.equal(restored.status, 200);
        branch.status = RestaurantStatus.INACTIVE;
        branch.active = false;
        assert.equal((await restored.json() as any).archivedAt, undefined);
        assert.equal(branch.status, RestaurantStatus.INACTIVE);
        assert.equal(branch.active, false);
        const created = await fetch(base + "/", {
          method: "POST",
          headers: {
            authorization: `Bearer ${jwt.sign({ sub: ownerId, role: "RESTAURANT_OWNER" }, process.env.JWT_SECRET || "change-me")}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            restaurantName: "New branch", restaurantEmail: "new@example.com", restaurantPhone: "123",
            address: "A", restaurantUsername: "branch-new", restaurantPassword: "secret1",
            confirmRestaurantPassword: "secret1"
          })
        });
        assert.equal(created.status, 201, JSON.stringify(await created.json()));
        assert.equal(createdWhileLeased, true, "branch creation must hold the shared owner quota lease at insert");
        archiveLeaseFails = true;
        const busyArchive = await request("DELETE", `/${restaurantId}`);
        assert.equal(busyArchive.status, 503);
        assert.equal((await busyArchive.json() as any).code, "RESTAURANT_QUOTA_BUSY");
        assert.ok(listFilters.every(filter => filter.ownerId.toString() === ownerId));
      } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    } finally {
      Restaurant.findOne = saved.findOne;
      Restaurant.findById = saved.findById;
      Restaurant.find = saved.find;
      Restaurant.countDocuments = saved.restaurantCount;
      Restaurant.findOneAndUpdate = saved.update;
      Restaurant.create = saved.restaurantCreate;
      Table.countDocuments = saved.tableCount;
      MenuItem.countDocuments = saved.menuCount;
      User.countDocuments = saved.staffCount;
      User.findOne = saved.userFindOne;
      User.findById = saved.userFindById;
      User.create = saved.userCreate;
      TableSession.countDocuments = saved.sessionCount;
      Bill.countDocuments = saved.billCount;
      Subscription.findOne = saved.subscriptionFind;
      Plan.findById = saved.planFind;
      OwnerRestaurantQuotaLease.findOneAndUpdate = saved.leaseUpdate;
      OwnerRestaurantQuotaLease.exists = saved.leaseExists;
      OwnerRestaurantQuotaLease.deleteOne = saved.leaseDelete;
      OwnerRestaurantQuotaLease.updateOne = saved.leaseUpdateOne;
      OwnerRestaurantQuotaLease.countDocuments = saved.leaseCount;
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
      scanCount: TableSession.countDocuments,
      quotaReservations: OwnerRestaurantQuotaLease.countDocuments
    };
    try {
      (Restaurant.countDocuments as any) = async (filter: any) => {
        assert.equal(filter.ownerId.toString(), ownerId);
        assert.deepEqual(filter.$or, [{ archivedAt: null }, { archiveTransitionId: { $exists: true } }]);
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
      (OwnerRestaurantQuotaLease.countDocuments as any) = async () => 1;
      const usage = await getOwnerUsage(ownerId);
      assert.deepEqual(usage, { restaurantCount: 2, tableCount: 2, menuItemCount: 2, staffCount: 2, scanCount: 2 });
    } finally {
      Restaurant.countDocuments = saved.restaurantCount;
      Restaurant.find = saved.restaurantFind;
      Table.countDocuments = saved.tableCount;
      MenuItem.countDocuments = saved.menuCount;
      User.countDocuments = saved.staffCount;
      TableSession.countDocuments = saved.scanCount;
      OwnerRestaurantQuotaLease.countDocuments = saved.quotaReservations;
    }
  }
  console.log("restaurant archive tests passed");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
