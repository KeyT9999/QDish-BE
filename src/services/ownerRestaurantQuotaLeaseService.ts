import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import mongoose from "mongoose";
import { OwnerRestaurantQuotaLease } from "../models/OwnerRestaurantQuotaLease.js";

export class OwnerRestaurantQuotaLeaseError extends Error {
  constructor(message: string) { super(message); }
}

export interface OwnerRestaurantQuotaLeaseHandle {
  assertHeld(): Promise<void>;
}

type LeaseStore = {
  tryAcquire(ownerId: string, token: string, expiresAt: Date, now: Date): Promise<boolean>;
  renew(ownerId: string, token: string, expiresAt: Date, now: Date): Promise<boolean>;
  isHeld(ownerId: string, token: string, now: Date): Promise<boolean>;
  release(ownerId: string, token: string): Promise<void>;
};

const mongoLeaseStore: LeaseStore = {
  async tryAcquire(ownerId, token, expiresAt, now) {
    try {
      const acquired = await OwnerRestaurantQuotaLease.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(ownerId), expiresAt: { $lte: now } },
        { $set: { token, expiresAt } },
        { upsert: true, new: true }
      );
      return acquired?.token === token;
    } catch (error: any) {
      // A competing holder's unique owner document makes the upsert fail.
      if (error?.code === 11000) return false;
      throw error;
    }
  },
  async renew(ownerId, token, expiresAt, now) {
    const renewed = await OwnerRestaurantQuotaLease.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(ownerId), token, expiresAt: { $gt: now } },
      { $set: { expiresAt } },
      { new: true }
    );
    return !!renewed;
  },
  async isHeld(ownerId, token, now) {
    return !!(await OwnerRestaurantQuotaLease.exists({
      _id: new mongoose.Types.ObjectId(ownerId), token, expiresAt: { $gt: now }
    }));
  },
  async release(ownerId, token) {
    await OwnerRestaurantQuotaLease.deleteOne({ _id: new mongoose.Types.ObjectId(ownerId), token });
  }
};

export function createOwnerRestaurantQuotaLeaseService(
  store: LeaseStore = mongoLeaseStore,
  options: { leaseMs?: number; renewMs?: number; retryMs?: number; waitMs?: number } = {}
) {
  const leaseMs = options.leaseMs ?? 30_000;
  const renewMs = options.renewMs ?? 5_000;
  const retryMs = options.retryMs ?? 50;
  const waitMs = options.waitMs ?? 5_000;

  return async <T>(ownerId: string, work: (lease: OwnerRestaurantQuotaLeaseHandle) => Promise<T>): Promise<T> => {
    if (!mongoose.isValidObjectId(ownerId)) throw new OwnerRestaurantQuotaLeaseError("Invalid owner ID");
    const token = randomUUID();
    const deadline = Date.now() + waitMs;
    while (!(await store.tryAcquire(ownerId, token, new Date(Date.now() + leaseMs), new Date()))) {
      if (Date.now() >= deadline) throw new OwnerRestaurantQuotaLeaseError("Restaurant quota is busy; please retry");
      await delay(retryMs);
    }

    let lost = false;
    let renewal: Promise<void> | undefined;
    const renew = () => {
      if (renewal) return;
      renewal = store.renew(ownerId, token, new Date(Date.now() + leaseMs), new Date())
        .then(held => { if (!held) lost = true; })
        .catch(() => { lost = true; })
        .finally(() => { renewal = undefined; });
    };
    const timer = setInterval(renew, renewMs);
    timer.unref();
    const lease: OwnerRestaurantQuotaLeaseHandle = {
      async assertHeld() {
        if (lost || !(await store.isHeld(ownerId, token, new Date()))) {
          throw new OwnerRestaurantQuotaLeaseError("Restaurant quota lease was lost; please retry");
        }
      }
    };
    try {
      const result = await work(lease);
      await lease.assertHeld();
      return result;
    } finally {
      clearInterval(timer);
      if (renewal) await renewal;
      await store.release(ownerId, token);
    }
  };
}

export const withOwnerRestaurantQuotaLease = createOwnerRestaurantQuotaLeaseService();
