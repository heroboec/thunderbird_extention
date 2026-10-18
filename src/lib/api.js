// Minimal client for an OpenAI-compatible API.

async function request(settings, path, init = {}) {
  const response = await fetch(`${settings.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 300) || response.statusText}`);
  }
  return response.json();
}

// Returns model ids available for the configured key.
export async function listModels(settings) {
  const data = await request(settings, "/models");
  return (data.data ?? []).map((m) => m.id).sort();
}

// Chat completion; returns the text of the first choice.
export async function chatCompletion(settings, body) {
  const data = await request(settings, "/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: settings.model, ...body }),
  });
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Пустой ответ нейросети");
  return content;
}
