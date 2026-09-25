import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  createRestaurantBranchSocketAccessService,
  createRestaurantSocketAccessService
} from "../services/restaurantSocketAccessService.js";

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

  const branchRestaurantId = new mongoose.Types.ObjectId();
  const branchOwnerId = new mongoose.Types.ObjectId();
  const branchRecord: {
    ownerId: mongoose.Types.ObjectId;
    archivedAt: Date | null;
    status: string;
    active: boolean;
  } = {
    ownerId: branchOwnerId,
    archivedAt: null,
    status: "ACTIVE",
    active: true
  };
  let joinedAuthorizedBranch = false;
  let branchLeaseOwner = "";
  const branchAccess = createRestaurantBranchSocketAccessService({
    Restaurant: {
      findById: async () => branchRecord
    } as any,
    withQuotaLease: async (id: string, work: (lease: { assertHeld(): Promise<void> }) => Promise<unknown>) => {
      branchLeaseOwner = id;
      return work({ assertHeld: async () => {} });
    }
  } as any);

  await branchAccess(
    { sub: branchOwnerId.toString(), role: "RESTAURANT_OWNER" },
    branchRestaurantId.toString(),
    () => { joinedAuthorizedBranch = true; }
  );
  assert.equal(joinedAuthorizedBranch, true, "an owner must be able to subscribe to an owned selected branch");
  assert.equal(branchLeaseOwner, branchOwnerId.toString(), "owner branch admission must coordinate with archive using the owner lease");

  let joinedForeignBranch = false;
  await assert.rejects(
    branchAccess(
      { sub: new mongoose.Types.ObjectId().toString(), role: "RESTAURANT_OWNER" },
      branchRestaurantId.toString(),
      () => { joinedForeignBranch = true; }
    ),
    (error: any) => error.code === "FORBIDDEN"
  );
  assert.equal(joinedForeignBranch, false, "an owner must never join another owner's branch room");

  let joinedWrongStaffBranch = false;
  await assert.rejects(
    branchAccess(
      { sub: "staff-user", role: "STAFF", restaurantId: new mongoose.Types.ObjectId().toString() },
      branchRestaurantId.toString(),
      () => { joinedWrongStaffBranch = true; }
    ),
    (error: any) => error.code === "FORBIDDEN"
  );
  assert.equal(joinedWrongStaffBranch, false, "staff must not choose a branch by client payload");

  branchRecord.archivedAt = new Date();
  await assert.rejects(
    branchAccess(
      { sub: branchOwnerId.toString(), role: "RESTAURANT_OWNER" },
      branchRestaurantId.toString(),
      () => assert.fail("an archived branch must not admit an owner socket")
    ),
    (error: any) => error.code === "RESTAURANT_ARCHIVED"
  );
}

run().then(() => console.log("restaurant socket access tests passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
