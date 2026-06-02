import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { initRealtime } from "../realtime/socket.js";

const VERCEL_ORIGIN = "https://qdish-three.vercel.app";

const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void>) => {
  const previous: Record<string, string | undefined> = {};

  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }

  try {
    await fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
};

async function testRealtimeCorsAllowsDeployedFrontendWhenAppBaseUrlDiffers() {
  await withEnv({
    APP_BASE_URL: "http://localhost:5173",
    CORS_ORIGINS: undefined,
    FRONTEND_URL: undefined,
    CLIENT_URL: undefined
  }, async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });

    initRealtime(server);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling`,
        {
          method: "OPTIONS",
          headers: {
            Origin: VERCEL_ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization"
          }
        }
      );

      assert.equal(response.status, 204);
      assert.equal(response.headers.get("access-control-allow-origin"), VERCEL_ORIGIN);
      assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
}

async function run() {
  await testRealtimeCorsAllowsDeployedFrontendWhenAppBaseUrlDiffers();
  console.log("cors config regression tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
