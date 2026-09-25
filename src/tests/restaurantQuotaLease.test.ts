import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createOwnerRestaurantQuotaLeaseService } from "../services/ownerRestaurantQuotaLeaseService.js";
import { createRestaurantArchiveService } from "../services/restaurantArchiveService.js";

const ownerId = "507f1f77bcf86cd799439011";

async function run() {
  let holder: { token: string; expiresAt: Date } | null = null;
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
