import assert from "node:assert/strict";

import { getDeploymentCommit } from "../config/deployment.js";

assert.equal(
  getDeploymentCommit({ RENDER_GIT_COMMIT: "render-sha", GIT_COMMIT_SHA: "fallback-sha" }),
  "render-sha"
);
assert.equal(getDeploymentCommit({ GIT_COMMIT_SHA: "fallback-sha" }), "fallback-sha");
assert.equal(getDeploymentCommit({}), null);

console.log("deployment metadata tests passed");
