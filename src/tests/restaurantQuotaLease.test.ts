import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createOwnerRestaurantQuotaLeaseService } from "../services/ownerRestaurantQuotaLeaseService.js";
import { createRestaurantArchiveService } from "../services/restaurantArchiveService.js";

const ownerId = "507f1f77bcf86cd799439011";

async function run() {
  let holder: { token: string; expiresAt: Date } | null = null;
  let reservation: { token: string; expiresAt: Date } | null = null;
  const store = {
    async tryAcquire(_ownerId: string, token: string, expiresAt: Date, now: Date) {
      if (holder && holder.expiresAt > now) return false;
      holder = { token, expiresAt };
      return true;
    },
    async renew(_ownerId: string, token: string, expiresAt: Date, now: Date) {
      if (!holder || holder.token !== token || holder.expiresAt <= now) return false;
      holder.expiresAt = expiresAt;
      return true;
    },
    async isHeld(_ownerId: string, token: string, now: Date) {
      return !!holder && holder.token === token && holder.expiresAt > now;
    },
    async release(_ownerId: string, token: string) {
      if (holder?.token === token) holder = null;
    },
    async reserve(_ownerId: string, leaseToken: string, reservationToken: string, expiresAt: Date, now: Date) {
      if (!holder || holder.token !== leaseToken || holder.expiresAt <= now) return false;
      if (reservation && reservation.expiresAt > now) return false;
      reservation = { token: reservationToken, expiresAt };
      return true;
    },
    async renewReservation(_ownerId: string, reservationToken: string, expiresAt: Date, now: Date) {
      if (!reservation || reservation.token !== reservationToken || reservation.expiresAt <= now) return false;
      reservation.expiresAt = expiresAt;
      return true;
    },
    async isReservationHeld(_ownerId: string, reservationToken: string, now: Date) {
      return !!reservation && reservation.token === reservationToken && reservation.expiresAt > now;
    },
    async releaseReservation(_ownerId: string, reservationToken: string) {
      if (reservation?.token === reservationToken) reservation = null;
    },
    async countReservations(_ownerId: string, now: Date) {
      return reservation && reservation.expiresAt > now ? 1 : 0;
    }
  };
  const firstProcess = createOwnerRestaurantQuotaLeaseService(store, { leaseMs: 150, renewMs: 30, retryMs: 5, waitMs: 1000 });
  const secondProcess = createOwnerRestaurantQuotaLeaseService(store, { leaseMs: 150, renewMs: 30, retryMs: 5, waitMs: 1000 });
  let activeOperations = 0;
  let maxActiveOperations = 0;
  let restaurantCount = 0;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  let firstEntered!: () => void;
  const entered = new Promise<void>(resolve => { firstEntered = resolve; });

  const create = firstProcess(ownerId, async lease => {
    activeOperations++;
    maxActiveOperations = Math.max(maxActiveOperations, activeOperations);
    assert.equal(restaurantCount, 0);
    firstEntered();
    await firstGate;
    await lease.assertHeld();
    restaurantCount++;
    activeOperations--;
  });
  await entered;
  const restore = secondProcess(ownerId, async lease => {
    activeOperations++;
    maxActiveOperations = Math.max(maxActiveOperations, activeOperations);
    const limitReached = restaurantCount >= 1;
    if (!limitReached) {
      await lease.assertHeld();
      restaurantCount++;
    }
    activeOperations--;
    return limitReached;
  });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(restaurantCount, 0, "second process must wait while the first holds a renewed lease");
  releaseFirst();
  await create;
  assert.equal(await restore, true, "restore must see the branch created under the same owner lease");
  assert.equal(restaurantCount, 1);
  assert.equal(maxActiveOperations, 1);
  assert.equal(holder, null);

  let stalledHolder: { token: string; expiresAt: Date } | null = null;
  let stalledReservation: { token: string; expiresAt: Date } | null = null;
  let firstLeaseToken = "";
  const stalledStore = {
    async tryAcquire(_ownerId: string, token: string, expiresAt: Date, now: Date) {
      if (stalledHolder && stalledHolder.expiresAt > now) return false;
      stalledHolder = { token, expiresAt };
      if (!firstLeaseToken) firstLeaseToken = token;
      return true;
    },
    async renew(_ownerId: string, token: string, expiresAt: Date, now: Date) {
      if (token === firstLeaseToken) return false;
      if (!stalledHolder || stalledHolder.token !== token || stalledHolder.expiresAt <= now) return false;
      stalledHolder.expiresAt = expiresAt;
      return true;
    },
    async isHeld(_ownerId: string, token: string, now: Date) {
      return !!stalledHolder && stalledHolder.token === token && stalledHolder.expiresAt > now;
    },
    async release(_ownerId: string, token: string) {
      if (stalledHolder?.token === token) stalledHolder = null;
    },
    async reserve(_ownerId: string, leaseToken: string, reservationToken: string, expiresAt: Date, now: Date) {
      if (!stalledHolder || stalledHolder.token !== leaseToken || stalledHolder.expiresAt <= now) return false;
      if (stalledReservation && stalledReservation.expiresAt > now) return false;
      stalledReservation = { token: reservationToken, expiresAt };
      return true;
    },
    async renewReservation(_ownerId: string, reservationToken: string, expiresAt: Date, now: Date) {
      if (!stalledReservation || stalledReservation.token !== reservationToken || stalledReservation.expiresAt <= now) return false;
      stalledReservation.expiresAt = expiresAt;
      return true;
    },
    async isReservationHeld(_ownerId: string, reservationToken: string, now: Date) {
      return !!stalledReservation && stalledReservation.token === reservationToken && stalledReservation.expiresAt > now;
    },
    async releaseReservation(_ownerId: string, reservationToken: string) {
      if (stalledReservation?.token === reservationToken) stalledReservation = null;
    },
    async countReservations(_ownerId: string, now: Date) {
      return stalledReservation && stalledReservation.expiresAt > now ? 1 : 0;
    }
  };
  const stalledProcess = createOwnerRestaurantQuotaLeaseService(stalledStore, {
    leaseMs: 70, renewMs: 15, retryMs: 5, waitMs: 500
  });
  const competingProcess = createOwnerRestaurantQuotaLeaseService(stalledStore, {
    leaseMs: 70, renewMs: 15, retryMs: 5, waitMs: 500
  });
  let durableBranches = 0;
  let finishStalledWrite!: () => void;
  const stalledWriteGate = new Promise<void>(resolve => { finishStalledWrite = resolve; });
  let reservationCreated!: () => void;
  const reservationReady = new Promise<void>(resolve => { reservationCreated = resolve; });
  const pendingCreate = stalledProcess(ownerId, async lease => {
    const slot = await lease.reserveRestaurantSlot();
    await lease.assertHeld();
    reservationCreated();
    await stalledWriteGate;
    durableBranches++;
    await slot.release();
  });
  await reservationReady;
  await new Promise(resolve => setTimeout(resolve, 110));
  const competingCreate = await competingProcess(ownerId, async () => {
    const usage = durableBranches + await stalledStore.countReservations(ownerId, new Date());
    if (usage >= 1) return false;
    durableBranches++;
    return true;
  });
  assert.equal(competingCreate, false, "an in-flight create reservation must consume the last slot after its mutex expires");
  finishStalledWrite();
  await pendingCreate;
  assert.equal(durableBranches, 1, "the stalled write and competing request must not exceed the restaurant limit");
  assert.equal(await stalledStore.countReservations(ownerId, new Date()), 0, "a persisted branch releases its reservation");

  const branchIds = ["507f1f77bcf86cd799439021", "507f1f77bcf86cd799439022"];
  const branches = new Map(branchIds.map(id => [id, {
    _id: new mongoose.Types.ObjectId(id), ownerId: new mongoose.Types.ObjectId(ownerId), archivedAt: new Date()
  }]));
  let activeBranches = 0;
  const dependencies = (withQuotaLease: typeof firstProcess) => ({
    Restaurant: {
      findOne: async (filter: any) => filter.ownerId.toString() === ownerId ? branches.get(filter._id.toString()) : null,
      findOneAndUpdate: async (filter: any, update: any) => {
        const branch = branches.get(filter._id.toString());
        if (!branch || filter.ownerId.toString() !== ownerId || !branch.archivedAt) return null;
        if (update.$unset?.archivedAt !== undefined) {
          (branch as any).archivedAt = undefined;
          activeBranches++;
        }
        return { ...branch };
      }
    },
    TableSession: { countDocuments: async () => 0 },
    Bill: { countDocuments: async () => 0 },
    checkPlanLimit: async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return activeBranches >= 1 ? { message: "Plan full", currentPlan: "FREE", limitValue: 1, currentUsage: 1 } : null;
    },
    withQuotaLease
  });
  const restoreA = createRestaurantArchiveService(dependencies(firstProcess) as any);
  const restoreB = createRestaurantArchiveService(dependencies(secondProcess) as any);
  const outcomes = await Promise.allSettled([
    restoreA.restore(ownerId, branchIds[0]),
    restoreB.restore(ownerId, branchIds[1])
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  const denied = outcomes.find(outcome => outcome.status === "rejected");
  assert.equal(denied?.status, "rejected");
  if (denied?.status === "rejected") {
    assert.equal(denied.reason.statusCode, 403);
    assert.equal(denied.reason.code, "PLAN_LIMIT_REACHED");
  }
  assert.equal(activeBranches, 1, "two restores must not consume one remaining slot");
  console.log("restaurant quota lease tests passed");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
