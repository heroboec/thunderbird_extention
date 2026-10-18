import { listModels } from "../lib/api.js";
import { findPreset, PRESETS } from "../lib/presets.js";
import { loadSettings, normalizeBaseUrl, normalizeDomain, originPattern, saveSettings } from "../lib/settings.js";

const form = document.getElementById("settings");
const fields = {
  domain: document.getElementById("domain"),
  baseUrl: document.getElementById("baseUrl"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
};
const modelList = document.getElementById("models");
const preset = document.getElementById("preset");

const CUSTOM = "custom";
preset.append(
  ...PRESETS.map((p) => new Option(p.name, p.baseUrl)),
  new Option("Свой адрес", CUSTOM),
);

// Keeps the preset list in sync with a manually edited address.
function syncPreset() {
  preset.value = findPreset(fields.baseUrl.value.trim().replace(/\/+$/, ""))?.baseUrl ?? CUSTOM;
}

const status = document.getElementById("status");

function showStatus(text, kind = "") {
  status.textContent = text;
  status.className = kind;
}

// Reads the form; throws with a user-facing message on invalid input.
function readForm() {
  return {
    domain: normalizeDomain(fields.domain.value),
    baseUrl: normalizeBaseUrl(fields.baseUrl.value),
    apiKey: fields.apiKey.value.trim(),
    model: fields.model.value.trim(),
  };
}

// Must be called synchronously from a click handler: permissions.request
// only works while handling user input.
function requestHostPermission(baseUrl) {
  return browser.permissions.request({ origins: [originPattern(baseUrl)] });
}

async function save(event) {
  event.preventDefault();
  let settings;
  try {
    settings = readForm();
  } catch (e) {
    showStatus(e.message, "error");
    return;
  }
  const granted = await requestHostPermission(settings.baseUrl);
  await saveSettings(settings);
  fields.domain.value = settings.domain;
  fields.baseUrl.value = settings.baseUrl;
  syncPreset();
  showStatus(
    granted ? "Сохранено" : "Сохранено, но без доступа к серверу запросы к API работать не будут",
    granted ? "ok" : "error",
  );
}

async function testConnection() {
  let settings;
  try {
    settings = readForm();
  } catch (e) {
    showStatus(e.message, "error");
    return;
  }
  const permission = requestHostPermission(settings.baseUrl);
  showStatus("Проверяю…");
  if (!(await permission)) {
    showStatus("Нет разрешения на доступ к серверу", "error");
    return;
  }
  try {
    const models = await listModels(settings);
    modelList.replaceChildren(...models.map((id) => new Option(id, id)));
    showStatus(`Подключение работает, доступно моделей: ${models.length}`, "ok");
  } catch (e) {
    showStatus(`Ошибка подключения: ${e.message}`, "error");
  }
}

document.getElementById("toggleKey").addEventListener("click", (event) => {
  const hidden = fields.apiKey.type === "password";
  fields.apiKey.type = hidden ? "text" : "password";
  event.target.textContent = hidden ? "Скрыть" : "Показать";
});
document.getElementById("test").addEventListener("click", testConnection);
preset.addEventListener("change", () => {
  if (preset.value === CUSTOM) {
    fields.baseUrl.focus();
    return;
  }
  fields.baseUrl.value = preset.value;
  modelList.replaceChildren();
});
fields.baseUrl.addEventListener("input", syncPreset);
form.addEventListener("submit", save);

const settings = await loadSettings();
for (const [name, input] of Object.entries(fields)) {
  input.value = settings[name];
}
syncPreset();
