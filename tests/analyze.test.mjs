import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeThread, normalizeAnalysis, parseJsonAnswer } from "../src/lib/analyze.js";

test("parseJsonAnswer accepts fenced JSON", () => {
  assert.deepEqual(parseJsonAnswer('```json\n{"a": 1}\n```'), { a: 1 });
  assert.throws(() => parseJsonAnswer("нет json"), /не JSON/);
});

test("normalizeAnalysis fills gaps and drops empty facts", () => {
  const a = normalizeAnalysis({ state: "weird", resolved: false, facts: [{ name: "Заказ", value: "123" }, { name: "x" }, null] });
  assert.equal(a.state, "waiting_us");
  assert.equal(a.resolved, false);
  assert.deepEqual(a.facts, [{ name: "Заказ", value: "123" }]);
  assert.equal(a.clientRequest, "");
  assert.equal(normalizeAnalysis({ state: "resolved" }).resolved, true);
});

test("analyzeThread sends thread to chat completions and parses answer", async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    const answer = { resolved: false, state: "waiting_client", client_request: "Вернуть деньги", facts: [{ name: "Заказ", value: "A-1" }], our_replies: "Попросили фото", next_action: "Ждать фото", client_language: "английский" };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
  };
  const result = await analyzeThread({ baseUrl: "https://api.openai.com/v1", apiKey: "sk-1", model: "m" }, "ТЕКСТ");
  assert.equal(sent.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(sent.init.headers.Authorization, "Bearer sk-1");
  assert.equal(sent.body.model, "m");
  assert.equal(sent.body.response_format.type, "json_object");
  assert.equal(sent.body.messages.at(-1).content, "ТЕКСТ");
  assert.equal(result.state, "waiting_client");
  assert.equal(result.nextAction, "Ждать фото");
});

test("analyzeThread surfaces API errors", async () => {
  globalThis.fetch = async () => new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 });
  await assert.rejects(analyzeThread({ baseUrl: "https://x/v1", apiKey: "k", model: "m" }, "t"), /HTTP 429.*insufficient_quota/);
});
