import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createRestaurantSocketAccessService } from "../services/restaurantSocketAccessService.js";

async function run() {
  const ownerId = new mongoose.Types.ObjectId();
  const restaurantId = new mongoose.Types.ObjectId();
  let archived = false;
  let leaseOwner = "";
  const access = createRestaurantSocketAccessService({
    Restaurant: {
      findById: async () => ({
        ownerId,
        get archivedAt() { return archived ? new Date() : null; }
      })
    } as any,
    withQuotaLease: async (id: string, work: (lease: { assertHeld(): Promise<void> }) => Promise<unknown>) => {
      leaseOwner = id;
      archived = true;
      return work({ assertHeld: async () => {} });
    }
  } as any);

  await assert.rejects(
    access({ sub: "staff-user", role: "STAFF", restaurantId: restaurantId.toString() }, () => {
      assert.fail("an archived branch socket must not join any rooms");
    }),
    (error: any) => error.code === "RESTAURANT_ARCHIVED"
  );
  assert.equal(leaseOwner, ownerId.toString(), "socket room admission must use the same owner lease as archive");

  let leaseHeld = false;
  let admittedWhileLocked = false;
  const activeAccess = createRestaurantSocketAccessService({
    Restaurant: {
      findById: async () => ({ ownerId, archivedAt: null })
    } as any,
    withQuotaLease: async (_id: string, work: (lease: { assertHeld(): Promise<void> }) => Promise<unknown>) => {
      leaseHeld = true;
      try {
        return await work({ assertHeld: async () => assert.equal(leaseHeld, true) });
      } finally {
        leaseHeld = false;
      }
    }
  } as any);
  await activeAccess(
    { sub: "staff-user", role: "STAFF", restaurantId: restaurantId.toString() },
    () => { admittedWhileLocked = leaseHeld; }
  );
  assert.equal(admittedWhileLocked, true, "a socket must join its room before releasing the owner lease");

  await activeAccess({ sub: "owner-user", role: "RESTAURANT_OWNER" }, () => {});
}

run().then(() => console.log("restaurant socket access tests passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
