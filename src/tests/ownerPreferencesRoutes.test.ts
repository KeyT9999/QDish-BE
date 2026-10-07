import "dotenv/config";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import type { AddressInfo } from "node:net";
import { connectDB } from "../config/db.js";
import { User, UserLanguage, UserRole } from "../models/User.js";

async function run() {
  await connectDB();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const owner = await User.create({
    username: `owner_preferences_${suffix}`,
    passwordHash: "test-only-hash",
    role: UserRole.RESTAURANT_OWNER
  });
  const otherOwner = await User.create({
    username: `other_owner_preferences_${suffix}`,
    passwordHash: "test-only-hash",
    role: UserRole.RESTAURANT_OWNER
  });
  const staff = await User.create({
    username: `staff_preferences_${suffix}`,
    passwordHash: "test-only-hash",
    role: UserRole.STAFF
  });

  const { default: authRouter } = await import("../routes/authRoutes.js");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${address.port}/api/auth/preferences`;
  const secret = process.env.JWT_SECRET || "change-me";
  const tokenFor = (userId: mongoose.Types.ObjectId, role: UserRole) =>
    jwt.sign({ sub: userId.toString(), role }, secret);
  const ownerToken = tokenFor(owner._id, UserRole.RESTAURANT_OWNER);
  const staffToken = tokenFor(staff._id, UserRole.STAFF);
  const unknownOwnerToken = tokenFor(new mongoose.Types.ObjectId(), UserRole.RESTAURANT_OWNER);
  const headers = (token?: string) => ({
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    "content-type": "application/json"
  });

  try {
    assert.equal((await fetch(endpoint)).status, 401, "preference reads require authentication");
    assert.equal((await fetch(endpoint, { headers: headers(staffToken) })).status, 403,
      "non-owner roles cannot read owner preferences");
    assert.equal((await fetch(endpoint, { headers: headers(unknownOwnerToken) })).status, 404,
      "unknown owner IDs cannot read preferences");

    const initial = await fetch(endpoint, { headers: headers(ownerToken) });
    assert.equal(initial.status, 200);
    assert.deepEqual(await initial.json(), { preferredLanguage: UserLanguage.VI },
      "new owner accounts default to Vietnamese");

    const savedEnglish = await fetch(endpoint, {
      method: "PATCH",
      headers: headers(ownerToken),
      body: JSON.stringify({ preferredLanguage: UserLanguage.EN })
    });
    assert.equal(savedEnglish.status, 200);
    assert.deepEqual(await savedEnglish.json(), { preferredLanguage: UserLanguage.EN });
    assert.equal((await User.findById(owner._id).select("preferredLanguage"))?.preferredLanguage, UserLanguage.EN,
      "the account preference is persisted");

    const invalidLanguage = await fetch(endpoint, {
      method: "PATCH",
      headers: headers(ownerToken),
      body: JSON.stringify({ preferredLanguage: "fr" })
    });
    assert.equal(invalidLanguage.status, 400, "unsupported locales are rejected");
    assert.equal((await User.findById(owner._id).select("preferredLanguage"))?.preferredLanguage, UserLanguage.EN,
      "invalid locales do not mutate the saved preference");

    const ignoredTargetId = await fetch(endpoint, {
      method: "PATCH",
      headers: headers(ownerToken),
      body: JSON.stringify({ preferredLanguage: UserLanguage.ZH_CN, userId: otherOwner._id.toString() })
    });
    assert.equal(ignoredTargetId.status, 200);
    assert.equal((await User.findById(owner._id).select("preferredLanguage"))?.preferredLanguage, UserLanguage.ZH_CN);
    assert.equal((await User.findById(otherOwner._id).select("preferredLanguage"))?.preferredLanguage, UserLanguage.VI,
      "request bodies cannot change another account's preference");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await User.deleteMany({ _id: { $in: [owner._id, otherOwner._id, staff._id] } });
    await mongoose.disconnect();
  }

  console.log("owner preferences route tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
