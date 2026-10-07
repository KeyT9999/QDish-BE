import assert from "node:assert/strict";
import {
  createTranslationProviderFailoverClient,
  TranslationProviderFailoverError
} from "../services/translationProviderFailover.js";

const messages = [{ role: "user" as const, content: "Translate this dish." }];

async function testUsesDeepSeekWhenPrimaryProviderFails() {
  const calls: string[] = [];
  const client = createTranslationProviderFailoverClient(
    { complete: async () => { calls.push("xkiro"); throw new Error("xKiro unavailable"); } },
    { complete: async () => { calls.push("deepseek"); return "translated"; } },
    () => true
  );

  assert.equal(await client.complete(messages), "translated");
  assert.deepEqual(calls, ["xkiro", "deepseek"]);
}

async function testDoesNotCallBackupWhenItIsNotConfigured() {
  const primaryError = new Error("xKiro unavailable");
  let backupCalled = false;
  const client = createTranslationProviderFailoverClient(
    { complete: async () => { throw primaryError; } },
    { complete: async () => { backupCalled = true; return "translated"; } },
    () => false
  );

  await assert.rejects(client.complete(messages), (error) => error === primaryError);
  assert.equal(backupCalled, false);
}

async function testRetainsBothProviderFailuresForSafeDiagnostics() {
  const primaryError = Object.assign(new Error("primary failed"), { code: "XKIRO_TIMEOUT" });
  const fallbackError = Object.assign(new Error("backup failed"), { code: "DEEPSEEK_UPSTREAM_ERROR", upstreamStatus: 503 });
  const client = createTranslationProviderFailoverClient(
    { complete: async () => { throw primaryError; } },
    { complete: async () => { throw fallbackError; } },
    () => true
  );

  await assert.rejects(client.complete(messages), (error: unknown) => {
    assert.ok(error instanceof TranslationProviderFailoverError);
    assert.equal(error.code, "TRANSLATION_PROVIDER_FAILOVER_UNAVAILABLE");
    assert.equal(error.primaryError, primaryError);
    assert.equal(error.fallbackError, fallbackError);
    return true;
  });
}

await testUsesDeepSeekWhenPrimaryProviderFails();
await testDoesNotCallBackupWhenItIsNotConfigured();
await testRetainsBothProviderFailuresForSafeDiagnostics();

console.log("translation provider failover tests passed");
