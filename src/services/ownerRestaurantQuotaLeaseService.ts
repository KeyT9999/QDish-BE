import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import mongoose from "mongoose";
import { OwnerRestaurantQuotaLease } from "../models/OwnerRestaurantQuotaLease.js";

export class OwnerRestaurantQuotaLeaseError extends Error {
  constructor(message: string) { super(message); }
}

export interface OwnerRestaurantQuotaLeaseHandle {
  assertHeld(): Promise<void>;
  reserveRestaurantSlot(): Promise<{ release(): Promise<void> }>;
}

type LeaseStore = {
  tryAcquire(ownerId: string, token: string, expiresAt: Date, now: Date): Promise<boolean>;
  renew(ownerId: string, token: string, expiresAt: Date, now: Date): Promise<boolean>;
  isHeld(ownerId: string, token: string, now: Date): Promise<boolean>;
  release(ownerId: string, token: string): Promise<void>;
  reserve(ownerId: string, leaseToken: string, reservationToken: string, expiresAt: Date, now: Date): Promise<boolean>;
  renewReservation(ownerId: string, reservationToken: string, expiresAt: Date, now: Date): Promise<boolean>;
  isReservationHeld(ownerId: string, reservationToken: string, now: Date): Promise<boolean>;
  releaseReservation(ownerId: string, reservationToken: string): Promise<void>;
  countReservations(ownerId: string, now: Date): Promise<number>;
};

const mongoLeaseStore: LeaseStore = {
  async tryAcquire(ownerId, token, expiresAt, now) {
    try {
      const acquired = await OwnerRestaurantQuotaLease.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(ownerId),
          $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $lte: now } }]
        },
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
    await OwnerRestaurantQuotaLease.updateOne(
      { _id: new mongoose.Types.ObjectId(ownerId), token },
      { $unset: { token: "", expiresAt: "" } }
    );
  },
  async reserve(ownerId, leaseToken, reservationToken, expiresAt, now) {
    const reservation = await OwnerRestaurantQuotaLease.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(ownerId),
        token: leaseToken,
        expiresAt: { $gt: now },
        $or: [
          { reservationExpiresAt: { $exists: false } },
          { reservationExpiresAt: { $lte: now } }
        ]
      },
      { $set: { reservationToken, reservationExpiresAt: expiresAt } },
      { new: true }
    );
    return reservation?.reservationToken === reservationToken;
  },
  async renewReservation(ownerId, reservationToken, expiresAt, now) {
    const renewed = await OwnerRestaurantQuotaLease.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(ownerId),
        reservationToken,
        reservationExpiresAt: { $gt: now }
      },
      { $set: { reservationExpiresAt: expiresAt } },
      { new: true }
    );
    return !!renewed;
  },
  async isReservationHeld(ownerId, reservationToken, now) {
    return !!(await OwnerRestaurantQuotaLease.exists({
      _id: new mongoose.Types.ObjectId(ownerId),
      reservationToken,
      reservationExpiresAt: { $gt: now }
    }));
  },
  async releaseReservation(ownerId, reservationToken) {
    await OwnerRestaurantQuotaLease.updateOne(
      { _id: new mongoose.Types.ObjectId(ownerId), reservationToken },
      { $unset: { reservationToken: "", reservationExpiresAt: "" } }
    );
  },
  async countReservations(ownerId, now) {
    return OwnerRestaurantQuotaLease.countDocuments({
      _id: new mongoose.Types.ObjectId(ownerId),
      reservationExpiresAt: { $gt: now }
    });
  }
};

export function createOwnerRestaurantQuotaLeaseService(
  store: LeaseStore = mongoLeaseStore,
  options: { leaseMs?: number; renewMs?: number; reservationMs?: number; retryMs?: number; waitMs?: number } = {}
) {
  const leaseMs = options.leaseMs ?? 30_000;
  const renewMs = options.renewMs ?? 5_000;
  const reservationMs = options.reservationMs ?? 5 * 60_000;
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
    let reservationToken: string | undefined;
    let reservationLost = false;
    let renewal: Promise<void> | undefined;
    const renew = () => {
      if (renewal) return;
      renewal = (async () => {
        const now = new Date();
        const held = await store.renew(ownerId, token, new Date(Date.now() + leaseMs), now);
        if (!held) lost = true;
        if (reservationToken) {
          const reservationHeld = await store.renewReservation(
            ownerId,
            reservationToken,
            new Date(Date.now() + reservationMs),
            now
          );
          if (!reservationHeld) reservationLost = true;
        }
      })()
        .catch(() => { lost = true; if (reservationToken) reservationLost = true; })
        .finally(() => { renewal = undefined; });
    };
    const timer = setInterval(renew, renewMs);
    timer.unref();
    const lease: OwnerRestaurantQuotaLeaseHandle = {
      async assertHeld() {
        const now = new Date();
        const held = !lost && await store.isHeld(ownerId, token, now);
        const reservationHeld = !reservationToken || (!reservationLost &&
          await store.isReservationHeld(ownerId, reservationToken, now));
        if (!held || !reservationHeld) {
          throw new OwnerRestaurantQuotaLeaseError("Restaurant quota lease was lost; please retry");
        }
      },
      async reserveRestaurantSlot() {
        await this.assertHeld();
        if (reservationToken) {
          throw new OwnerRestaurantQuotaLeaseError("A restaurant quota slot is already reserved");
        }
        const nextReservationToken = randomUUID();
        const reserved = await store.reserve(
          ownerId,
          token,
          nextReservationToken,
          new Date(Date.now() + reservationMs),
          new Date()
        );
        if (!reserved) {
          throw new OwnerRestaurantQuotaLeaseError("A restaurant quota slot is already in progress; please retry");
        }
        reservationToken = nextReservationToken;
        reservationLost = false;
        return {
          async release() {
            await store.releaseReservation(ownerId, nextReservationToken);
            if (reservationToken === nextReservationToken) reservationToken = undefined;
          }
        };
      }
    };
    try {
      const result = await work(lease);
      return result;
    } finally {
      clearInterval(timer);
      if (renewal) await renewal;
      await store.release(ownerId, token);
    }
  };
}

export const withOwnerRestaurantQuotaLease = createOwnerRestaurantQuotaLeaseService();
