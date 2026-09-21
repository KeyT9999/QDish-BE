import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import userProfileRoutes from "../routes/userProfileRoutes.js";
import { UserDiningProfile } from "../models/UserDiningProfile.js";

type RouteMethod = "get" | "put" | "post";

function findRoute(path: string, method: RouteMethod) {
  const layer = (userProfileRoutes as any).stack.find(
    (candidate: any) => candidate.route?.path === path && candidate.route?.methods?.[method]
  );
  assert.ok(layer, `route ${method.toUpperCase()} ${path} should exist`);
  return layer.route.stack.map((entry: any) => entry.handle);
}

function makeResponse() {
  const state: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const response = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
  };
  return { state, response };
}

async function invoke(path: string, method: RouteMethod, reqOverrides: Record<string, unknown> = {}) {
  const { state, response } = makeResponse();
  const req = {
    params: { userId: "victim-user" },
    headers: {},
    query: {},
    body: {},
    ...reqOverrides,
  } as any;
  const handlers = findRoute(path, method);
  let index = 0;

  const next = async () => {
    const handler = handlers[index++];
    if (handler) {
      await handler(req, response, next);
    }
  };

  await next();
  return state;
}

async function testUnauthenticatedProfileRoutesAreRejected() {
  const originalFindOne = UserDiningProfile.findOne;
  const originalFindOneAndUpdate = UserDiningProfile.findOneAndUpdate;
  const originalCreate = UserDiningProfile.create;

  (UserDiningProfile.findOne as any) = async () => ({ userId: "victim-user" });
  (UserDiningProfile.findOneAndUpdate as any) = async () => ({ userId: "victim-user" });
  (UserDiningProfile.create as any) = async () => ({ userId: "victim-user" });

  try {
    for (const [path, method] of [
      ["/profile/:userId", "get"],
      ["/profile/:userId", "put"],
      ["/profile/:userId/onboarding", "post"],
    ] as const) {
      const result = await invoke(path, method);
      assert.equal(result.statusCode, 401, `${method.toUpperCase()} ${path} must require authentication`);
    }
  } finally {
    (UserDiningProfile.findOne as any) = originalFindOne;
    (UserDiningProfile.findOneAndUpdate as any) = originalFindOneAndUpdate;
    (UserDiningProfile.create as any) = originalCreate;
  }
}

async function testAuthenticatedCallerCannotAccessAnotherProfile() {
  const originalFindOne = UserDiningProfile.findOne;
  const originalFindOneAndUpdate = UserDiningProfile.findOneAndUpdate;

  (UserDiningProfile.findOne as any) = async () => ({ userId: "victim-user" });
  (UserDiningProfile.findOneAndUpdate as any) = async () => ({ userId: "victim-user" });

  try {
    const token = jwt.sign(
      { sub: "attacker-user", role: "RESTAURANT_OWNER" },
      process.env.JWT_SECRET || "change-me"
    );

    for (const [path, method] of [
      ["/profile/:userId", "get"],
      ["/profile/:userId", "put"],
      ["/profile/:userId/onboarding", "post"],
    ] as const) {
      const result = await invoke(path, method, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(result.statusCode, 403, `${method.toUpperCase()} ${path} must enforce profile ownership`);
    }
  } finally {
    (UserDiningProfile.findOne as any) = originalFindOne;
    (UserDiningProfile.findOneAndUpdate as any) = originalFindOneAndUpdate;
  }
}

async function run() {
  await testUnauthenticatedProfileRoutesAreRejected();
  await testAuthenticatedCallerCannotAccessAnotherProfile();
  console.log("user profile route authorization tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
