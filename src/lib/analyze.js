// Asking the model what is going on in a support thread.

import { chatCompletion } from "./api.js";
import { getCached, setCached } from "./cache.js";
import { originPattern } from "./settings.js";

// Bump when the prompt or the result format changes, so cached analyses
// made with the old prompt are not reused.
export const PROMPT_VERSION = 2;

// Who has to act next in the thread.
export const STATES = {
  no_reply: "Ещё не ответили",
  waiting_us: "Ход за нами",
  waiting_client: "Ждём клиента",
  resolved: "Решено",
};

const SYSTEM_PROMPT = `Ты помощник сотрудника службы поддержки. Тебе дают переписку с клиентом.
У каждого письма в строке «От:» стоит пометка: [мы] — письмо нашей стороны (поддержка), [клиент] — письмо клиента.
Письма идут от старых к новым. В письмах могут быть цитаты предыдущих писем — не считай их новыми сообщениями.
В одной переписке клиент может поднимать несколько разных вопросов: одни уже решены, другие ещё открыты. Раздели их.

Верни строго JSON-объект такого вида:
{
  "state": общее состояние, одно из "no_reply" (клиент написал, мы ещё ни разу не ответили), "waiting_us" (последнее слово за клиентом, ход за нами), "waiting_client" (мы ждём от клиента данные, подтверждение или действие), "resolved" (все вопросы решены, ничего делать не нужно),
  "summary": "суть переписки в 1–2 предложениях",
  "issues": [
    {
      "title": "короткое название вопроса",
      "resolved": true или false,
      "client_request": "что клиент хочет по этому вопросу",
      "our_reply": "что мы ответили или сделали по этому вопросу; пустая строка, если ничего",
      "next_action": "что сделать по этому вопросу сейчас; пустая строка, если вопрос решён"
    }
  ] — вопросы в порядке появления в переписке,
  "facts": [{"name": "что это", "value": "значение"}] — номера заказов, ссылки, трек-номера, суммы, даты, названия товаров, телефоны и другие конкретные факты из переписки,
  "next_action": "что сотруднику нужно сделать сейчас для клиента по всем открытым вопросам, конкретно; пустая строка, если ничего",
  "client_language": "на каком языке пишет клиент"
}

Правила:
- Все тексты пиши на русском языке, даже если переписка на другом языке.
- Значения фактов (номера, ссылки, суммы, коды) копируй дословно, не переводи и не меняй.
- Не выдумывай: если чего-то нет в переписке, не пиши этого.`;

const text = (value) => String(value ?? "");

// Fills in missing fields so a sloppy model answer still renders.
export function normalizeAnalysis(raw) {
  const issues = (Array.isArray(raw.issues) ? raw.issues : [])
    .filter((i) => i && (i.title || i.client_request))
    .map((i) => ({
      title: text(i.title),
      resolved: i.resolved === true,
      clientRequest: text(i.client_request),
      ourReply: text(i.our_reply),
      nextAction: text(i.next_action),
    }));
  const allResolved = issues.length > 0 && issues.every((i) => i.resolved);
  const state = raw.state in STATES ? raw.state : allResolved ? "resolved" : "waiting_us";
  return {
    state,
    resolved: state === "resolved" || allResolved,
    summary: text(raw.summary),
    issues,
    facts: (Array.isArray(raw.facts) ? raw.facts : [])
      .filter((f) => f && f.value)
      .map((f) => ({ name: text(f.name), value: text(f.value) })),
    nextAction: text(raw.next_action),
    clientLanguage: text(raw.client_language),
  };
}

// Extracts the JSON object even if the model wrapped it in ```json fences.
export function parseJsonAnswer(content) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("Нейросеть вернула не JSON");
  return JSON.parse(content.slice(start, end + 1));
}

export async function analyzeThread(settings, threadText) {
  const content = await chatCompletion(settings, {
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: threadText },
    ],
  });
  return normalizeAnalysis(parseJsonAnswer(content));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Analysis of a thread text, remembered by the text itself: a thread with
// no new messages (and the same model, domain and prompt) has the same text
// and is answered from the cache, wherever it was analyzed before.
// cacheOnly returns null instead of calling the model; force skips the cache.
export async function getAnalysis(settings, threadText, { force = false, cacheOnly = false } = {}) {
  const key = await sha256(`${PROMPT_VERSION}\n${settings.baseUrl}\n${settings.model}\n${threadText}`);
  if (!force) {
    const hit = await getCached("analysis", key);
    if (hit) return { ...hit, fromCache: true };
  }
  if (cacheOnly) return null;
  if (!settings.apiKey || !settings.model) {
    throw new Error("Не заданы API-ключ или модель — откройте настройки расширения");
  }
  if (!(await browser.permissions.contains({ origins: [originPattern(settings.baseUrl)] }))) {
    throw new Error("Нет доступа к серверу API — откройте настройки расширения и нажмите «Сохранить»");
  }
  const analysis = await analyzeThread(settings, threadText);
  await setCached("analysis", key, analysis);
  return analysis;
}
