// Extension settings stored in browser.storage.local (stays in the
// Thunderbird profile, never synced).

import { PRESETS } from "./presets.js";

export const DEFAULTS = {
  domain: "",
  baseUrl: PRESETS[0].baseUrl,
  apiKey: "",
  model: "",
  autoAnalyze: true,
};

export async function loadSettings() {
  const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(settings) {
  await browser.storage.local.set(settings);
}

// Accepts "api.example.com", "https://api.example.com/v1/", etc.
// Returns "https://api.example.com/v1" style URL without a trailing slash.
export function normalizeBaseUrl(input) {
  let value = input.trim();
  if (!value) {
    throw new Error("Укажите адрес API");
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/+$/, "");
}

// Accepts "Company.ru", "@company.ru", "https://company.ru/path", etc.
// Returns a bare lowercase domain, or "" for empty input.
export function normalizeDomain(input) {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^.*@/, "")
    .replace(/[/:?#].*$/, "")
    .replace(/\.$/, "");
  if (value && !/^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+$/u.test(value)) {
    throw new Error(`Некорректный домен: ${input.trim()}`);
  }
  return value;
}

// Host permission pattern for the API server. Match patterns can't carry
// a port, so "http://localhost:1234" becomes "http://localhost/*".
export function originPattern(baseUrl) {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.hostname}/*`;
}
