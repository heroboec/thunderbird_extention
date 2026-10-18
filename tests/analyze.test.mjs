import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeThread, normalizeAnalysis, parseJsonAnswer } from "../src/lib/analyze.js";

test("parseJsonAnswer accepts fenced JSON", () => {
  assert.deepEqual(parseJsonAnswer('```json\n{"a": 1}\n```'), { a: 1 });
  assert.throws(() => parseJsonAnswer("нет json"), /не JSON/);
});

test("normalizeAnalysis fills gaps and drops empty facts and issues", () => {
  const a = normalizeAnalysis({ state: "weird", facts: [{ name: "Заказ", value: "123" }, { name: "x" }, null], issues: [null, {}] });
  assert.equal(a.state, "waiting_us");
  assert.equal(a.resolved, false);
  assert.deepEqual(a.facts, [{ name: "Заказ", value: "123" }]);
  assert.deepEqual(a.issues, []);
  assert.equal(a.summary, "");
  assert.equal(normalizeAnalysis({ state: "resolved" }).resolved, true);
});

test("normalizeAnalysis keeps several issues with their status", () => {
  const a = normalizeAnalysis({
    issues: [
      { title: "Возврат", resolved: true, client_request: "вернуть деньги", our_reply: "вернули", next_action: "" },
      { title: "Доставка", resolved: false, client_request: "где посылка", our_reply: "", next_action: "дать трек" },
    ],
  });
  assert.deepEqual(a.issues.map((i) => [i.title, i.resolved]), [["Возврат", true], ["Доставка", false]]);
  assert.equal(a.issues[1].nextAction, "дать трек");
  assert.equal(a.state, "waiting_us");
  assert.equal(normalizeAnalysis({ issues: [{ title: "x", resolved: true }] }).state, "resolved");
});

test("analyzeThread sends thread to chat completions and parses answer", async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    const answer = { state: "waiting_client", summary: "Возврат", issues: [{ title: "Возврат", resolved: false, client_request: "Вернуть деньги", our_reply: "Попросили фото", next_action: "Ждать фото" }], facts: [{ name: "Заказ", value: "A-1" }], next_action: "Ждать фото", client_language: "английский" };
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
  assert.equal(result.issues[0].ourReply, "Попросили фото");
});

test("analyzeThread surfaces API errors", async () => {
  globalThis.fetch = async () => new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 });
  await assert.rejects(analyzeThread({ baseUrl: "https://x/v1", apiKey: "k", model: "m" }, "t"), /HTTP 429.*insufficient_quota/);
});

test("getAnalysis remembers results by thread text", async () => {
  const { fakeStorage } = await import("./fake-storage.mjs");
  const { getAnalysis } = await import("../src/lib/analyze.js");
  globalThis.browser = { storage: { local: fakeStorage() }, permissions: { contains: async () => true } };
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"state":"resolved"}' } }] }));
  };
  const settings = { baseUrl: "https://x/v1", apiKey: "k", model: "m" };
  assert.equal(await getAnalysis(settings, "A", { cacheOnly: true }), null);
  await getAnalysis(settings, "A");
  const again = await getAnalysis(settings, "A");
  assert.equal(again.fromCache, true);
  assert.equal(requests, 1);
  await getAnalysis(settings, "A", { force: true });
  await getAnalysis(settings, "B");
  await getAnalysis({ ...settings, model: "other" }, "A");
  assert.equal(requests, 4);
});
