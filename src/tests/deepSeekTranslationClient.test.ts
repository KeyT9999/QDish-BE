import assert from "node:assert/strict";
import {
  createDeepSeekTranslationClient,
  DEEPSEEK_CHAT_COMPLETIONS_URL,
  DeepSeekTranslationClientError
} from "../services/deepSeekTranslationClient.js";

const messages = [
  { role: "system" as const, content: "Return only JSON." },
  { role: "user" as const, content: "Translate this dish." }
];

async function testSendsOpenAICompatibleJsonRequest() {
  let requestedUrl = "";
  let authorization = "";
  let requestBody: Record<string, unknown> = {};
  const client = createDeepSeekTranslationClient({
    apiKey: "test-only-key",
    fetcher: async (url, init) => {
      requestedUrl = url;
      authorization = new Headers(init.headers).get("authorization") ?? "";
      requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: "{\"en\":{\"name\":\"Dish\"},\"zhCN\":{\"name\":\"菜\"}}" } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const result = await client.complete(messages);

  assert.equal(result, "{\"en\":{\"name\":\"Dish\"},\"zhCN\":{\"name\":\"菜\"}}");
  assert.equal(requestedUrl, DEEPSEEK_CHAT_COMPLETIONS_URL);
  assert.equal(authorization, "Bearer test-only-key");
  assert.equal(requestBody.model, "deepseek-flash");
  assert.deepEqual(requestBody.messages, messages);
  assert.deepEqual(requestBody.response_format, { type: "json_object" });
  assert.deepEqual(requestBody.thinking, { type: "disabled" });
  assert.equal(requestBody.stream, false);
}

async function testRejectsMissingCredentialsWithoutCallingProvider() {
  let called = false;
  const client = createDeepSeekTranslationClient({
    apiKey: "",
    fetcher: async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }
  });

  await assert.rejects(client.complete(messages), (error: any) => error.code === "DEEPSEEK_NOT_CONFIGURED");
  assert.equal(called, false);
}

async function testPreservesUpstreamStatusWithoutLeakingBody() {
  const client = createDeepSeekTranslationClient({
    apiKey: "test-only-key",
    fetcher: async () => new Response("sensitive upstream response", { status: 503 })
  });

  await assert.rejects(client.complete(messages), (error: unknown) => {
    assert.ok(error instanceof DeepSeekTranslationClientError);
    assert.equal(error.upstreamStatus, 503);
    assert.equal(error.code, "DEEPSEEK_UPSTREAM_ERROR");
    assert.equal(error.message.includes("sensitive upstream response"), false);
    return true;
  });
}

await testSendsOpenAICompatibleJsonRequest();
await testRejectsMissingCredentialsWithoutCallingProvider();
await testPreservesUpstreamStatusWithoutLeakingBody();

console.log("DeepSeek translation client tests passed");
