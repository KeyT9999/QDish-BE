import assert from "node:assert/strict";
import { createXKiroTranslationClient } from "../services/xKiroTranslationClient.js";

const messages = [
  { role: "system" as const, content: "Translate menu text as JSON." },
  { role: "user" as const, content: "Translate this menu item." }
];

function completion(content: string) {
  return {
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }]
  };
}

async function testPostsOpenAiCompatibleRequestAndParsesResponse() {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const client = createXKiroTranslationClient({
    apiKey: "test-only-key",
    modelId: "qwen/qwen3.8-max",
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify(completion("{\"ok\":true}")), { status: 200 });
    }
  });

  assert.equal(await client.complete(messages), "{\"ok\":true}");
  assert.equal(requestUrl, "https://api.xkiro.com/v1/chat/completions");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer test-only-key");
  assert.equal(new Headers(requestInit?.headers).get("content-type"), "application/json");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.signal instanceof AbortSignal, true);
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    model: "qwen/qwen3.8-max",
    messages,
    response_format: { type: "json_object" },
    max_tokens: 800,
    stream: false
  });
}

async function testMissingApiKeyFailsWithoutExposingCredential() {
  const client = createXKiroTranslationClient({ apiKey: "" });
  await assert.rejects(client.complete(messages), (error: any) => {
    assert.equal(error.code, "XKIRO_NOT_CONFIGURED");
    assert.equal(String(error.message).includes("test-only-key"), false);
    return true;
  });
}

async function testUsesQwenDefaultAndAllowsEnvironmentOverride() {
  const previousModelId = process.env.XKIRO_MODEL_ID;
  let requestedModel = "";
  const fetcher = async (_input: string, init: RequestInit) => {
    requestedModel = JSON.parse(String(init.body)).model;
    return new Response(JSON.stringify(completion("{}")), { status: 200 });
  };

  try {
    delete process.env.XKIRO_MODEL_ID;
    await createXKiroTranslationClient({ apiKey: "test-only-key", fetcher }).complete(messages);
    assert.equal(requestedModel, "qwen/qwen3.8-max");

    process.env.XKIRO_MODEL_ID = "vendor/model-override";
    await createXKiroTranslationClient({ apiKey: "test-only-key", fetcher }).complete(messages);
    assert.equal(requestedModel, "vendor/model-override");
  } finally {
    if (previousModelId === undefined) delete process.env.XKIRO_MODEL_ID;
    else process.env.XKIRO_MODEL_ID = previousModelId;
  }
}

async function testMalformedProviderEnvelopeIsRejected() {
  const client = createXKiroTranslationClient({
    apiKey: "test-only-key",
    fetcher: async () => new Response("not-json", { status: 200 })
  });
  await assert.rejects(client.complete(messages), (error: any) => error.code === "XKIRO_INVALID_RESPONSE");

  const missingContent = createXKiroTranslationClient({
    apiKey: "test-only-key",
    fetcher: async () => new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 })
  });
  await assert.rejects(missingContent.complete(messages), (error: any) => error.code === "XKIRO_INVALID_RESPONSE");
}

async function testProviderFailureUsesSafeError() {
  const client = createXKiroTranslationClient({
    apiKey: "test-only-key",
    fetcher: async () => new Response(JSON.stringify({ error: { message: "credential test-only-key rejected" } }), {
      status: 402,
      headers: { "retry-after": "17" }
    })
  });
  await assert.rejects(client.complete(messages), (error: any) => {
    assert.equal(error.code, "XKIRO_UPSTREAM_ERROR");
    assert.equal(error.message.includes("test-only-key"), false);
    assert.equal(error.upstreamStatus, 402);
    assert.equal(error.retryAfterSeconds, 17);
    return true;
  });
}

async function testRetriesTransientUpstreamFailuresWithRetryAfter() {
  let attempts = 0;
  const waits: number[] = [];
  const client = createXKiroTranslationClient({
    apiKey: "test-only-key",
    wait: async (milliseconds) => { waits.push(milliseconds); },
    fetcher: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { code: "bad_gateway" } }), {
          status: 502,
          headers: { "retry-after": "0" }
        });
      }
      return new Response(JSON.stringify(completion("{\"ok\":true}")), { status: 200 });
    }
  });

  assert.equal(await client.complete(messages), "{\"ok\":true}");
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [0]);
}

async function testTimeoutAbortsTheRequest() {
  let signal: AbortSignal | null | undefined;
  const client = createXKiroTranslationClient({
    apiKey: "test-only-key",
    timeoutMs: 5,
    fetcher: async (_input, init) => {
      signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
  });

  await assert.rejects(client.complete(messages), (error: any) => error.code === "XKIRO_TIMEOUT");
  assert.equal(signal?.aborted, true);
}

await testPostsOpenAiCompatibleRequestAndParsesResponse();
await testMissingApiKeyFailsWithoutExposingCredential();
await testUsesQwenDefaultAndAllowsEnvironmentOverride();
await testMalformedProviderEnvelopeIsRejected();
await testProviderFailureUsesSafeError();
await testRetriesTransientUpstreamFailuresWithRetryAfter();
await testTimeoutAbortsTheRequest();

console.log("xKiro translation client tests passed");
