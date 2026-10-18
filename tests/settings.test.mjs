import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeBaseUrl, originPattern } from "../src/lib/settings.js";

test("normalizeBaseUrl adds https and strips trailing slash", () => {
  assert.equal(normalizeBaseUrl("api.openai.com/v1/"), "https://api.openai.com/v1");
  assert.equal(normalizeBaseUrl("  https://api.example.com  "), "https://api.example.com");
});

test("normalizeBaseUrl keeps http, port and path", () => {
  assert.equal(normalizeBaseUrl("http://localhost:1234/v1"), "http://localhost:1234/v1");
});

test("normalizeBaseUrl drops query and hash", () => {
  assert.equal(normalizeBaseUrl("https://x.com/v1?a=1#b"), "https://x.com/v1");
});

test("normalizeBaseUrl rejects empty and garbage input", () => {
  assert.throws(() => normalizeBaseUrl("   "), /Укажите адрес API/);
  assert.throws(() => normalizeBaseUrl("http://"));
});

test("originPattern drops port and path", () => {
  assert.equal(originPattern("http://localhost:1234/v1"), "http://localhost/*");
  assert.equal(originPattern("https://api.openai.com/v1"), "https://api.openai.com/*");
});
