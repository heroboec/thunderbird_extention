import assert from "node:assert/strict";
import { test } from "node:test";
import { findPreset, PRESETS } from "../src/lib/presets.js";
import { DEFAULTS, normalizeBaseUrl } from "../src/lib/settings.js";

test("default address is OpenAI", () => {
  assert.equal(DEFAULTS.baseUrl, "https://api.openai.com/v1");
});

test("preset addresses are already normalized", () => {
  for (const p of PRESETS) assert.equal(normalizeBaseUrl(p.baseUrl), p.baseUrl, p.name);
});

test("findPreset matches only known addresses", () => {
  assert.equal(findPreset("https://openrouter.ai/api/v1").name, "OpenRouter");
  assert.equal(findPreset("https://my.server/v1"), undefined);
});
