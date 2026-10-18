// Known OpenAI-compatible API servers offered in settings.

export const PRESETS = [
  { name: "OpenAI (ChatGPT)", baseUrl: "https://api.openai.com/v1" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { name: "Ollama (локально)", baseUrl: "http://localhost:11434/v1" },
  { name: "LM Studio (локально)", baseUrl: "http://localhost:1234/v1" },
];

// Preset with this base URL, if any.
export function findPreset(baseUrl) {
  return PRESETS.find((p) => p.baseUrl === baseUrl);
}
