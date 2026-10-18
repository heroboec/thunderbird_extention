// Asking the model what is going on in a support thread.

import { chatCompletion } from "./api.js";

// Bump when the prompt or the result format changes, so cached analyses
// made with the old prompt are not reused.
export const PROMPT_VERSION = 1;

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

Проанализируй переписку и верни строго JSON-объект такого вида:
{
  "resolved": true или false — решён ли вопрос клиента,
  "state": одно из "no_reply" (клиент написал, мы ещё ни разу не ответили), "waiting_us" (мы отвечали, но последнее слово за клиентом и ход за нами), "waiting_client" (мы ждём от клиента данные, подтверждение или действие), "resolved" (вопрос решён, ничего делать не нужно),
  "client_request": "что клиент от нас хочет, 1–3 предложения",
  "facts": [{"name": "что это", "value": "значение"}] — номера заказов, ссылки, трек-номера, суммы, даты, названия товаров, телефоны и другие конкретные факты из переписки,
  "our_replies": "что мы уже ответили и сделали, кратко; пустая строка, если не отвечали",
  "next_action": "что сотруднику нужно сделать сейчас для клиента, конкретно",
  "client_language": "на каком языке пишет клиент"
}

Правила:
- Все тексты пиши на русском языке, даже если переписка на другом языке.
- Значения фактов (номера, ссылки, суммы, коды) копируй дословно, не переводи и не меняй.
- Не выдумывай: если чего-то нет в переписке, не пиши этого.`;

// Fills in missing fields so a sloppy model answer still renders.
export function normalizeAnalysis(raw) {
  const state = raw.state in STATES ? raw.state : raw.resolved ? "resolved" : "waiting_us";
  return {
    resolved: raw.resolved === true || state === "resolved",
    state,
    clientRequest: String(raw.client_request ?? ""),
    facts: (Array.isArray(raw.facts) ? raw.facts : [])
      .filter((f) => f && f.value)
      .map((f) => ({ name: String(f.name ?? ""), value: String(f.value) })),
    ourReplies: String(raw.our_replies ?? ""),
    nextAction: String(raw.next_action ?? ""),
    clientLanguage: String(raw.client_language ?? ""),
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
