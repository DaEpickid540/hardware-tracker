// ============================================================
//  aria.js — multi-provider AI assistant
//  Providers: Anthropic (Claude) · OpenAI · Google (Gemini)
//  Keys are passed in from per-user settings (stored in Firestore).
//  Calls go directly from the browser — fine for a personal tool.
// ============================================================

export const PROVIDERS = {
  anthropic: { label: "Claude (Anthropic)", defaultModel: "claude-opus-4-8" },
  openai:    { label: "OpenAI (GPT)",       defaultModel: "gpt-4o" },
  google:    { label: "Gemini (Google)",    defaultModel: "gemini-2.0-flash" },
  groq:      { label: "Groq",               defaultModel: "llama-3.3-70b-versatile" },
};

// Optional web-search providers that augment ARIA with live results.
export const SEARCH_PROVIDERS = {
  none:   { label: "Off" },
  tavily: { label: "Tavily", keyId: "tavily" },
};

// Tavily search → returns a context block to inject into the system prompt.
async function tavilySearch(key, query) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: 5, search_depth: "basic", include_answer: true }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || d?.detail || `Tavily ${res.status}`);
  const lines = [`LIVE WEB SEARCH (Tavily) for "${query}":`];
  if (d.answer) lines.push(`Summary: ${d.answer}`);
  (d.results || []).forEach((r, i) =>
    lines.push(`${i + 1}. ${r.title} — ${r.url}\n   ${(r.content || "").slice(0, 300)}`));
  lines.push("Use these results when relevant and cite the URLs.");
  return lines.join("\n");
}

function systemPrompt(inventory) {
  let inv = "The user's current inventory is empty.";
  if (inventory && inventory.length) {
    inv = "The user currently has these components in their inventory " +
      "(category → items):\n" +
      inventory.map((c) => `- ${c.category}: ${c.items.join(", ") || "(none)"}`).join("\n");
  }
  return [
    "You are ARIA, a hardware & electronics build assistant inside a personal",
    "component-inventory app. The user catalogs parts like ESP32s, Raspberry Pis,",
    "18650/21700 cells, sensors, drivers, etc.",
    "",
    "When asked what they need for a build (e.g. \"what do I need to connect an",
    "18650 pack to an ESP32\"), give a precise, practical parts list:",
    "- name each required part and why it's needed",
    "- include key specs (voltage, current, protection, regulators, BMS, etc.)",
    "- mention wiring/connection notes and any safety considerations (Li-ion!)",
    "- if they ALREADY own a suitable part (see inventory below), say so",
    "Be concise and concrete. Prefer bullet lists over long prose.",
    "",
    inv,
  ].join("\n");
}

// Convert internal {role:'user'|'assistant', content} history per provider.
async function callAnthropic(key, model, sys, history) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model, max_tokens: 1500, system: sys,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic ${res.status}`);
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

// OpenAI-compatible chat completions (OpenAI + Groq share this shape)
async function callOpenAICompatible(url, label, key, model, sys, history) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: sys },
        ...history.map((m) => ({ role: m.role, content: m.content }))],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `${label} ${res.status}`);
  return data.choices?.[0]?.message?.content || "";
}
const callOpenAI = (key, model, sys, history) =>
  callOpenAICompatible("https://api.openai.com/v1/chat/completions", "OpenAI", key, model, sys, history);
const callGroq = (key, model, sys, history) =>
  callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", "Groq", key, model, sys, history);

async function callGemini(key, model, sys, history) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: history.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      }),
    });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gemini ${res.status}`);
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
}

// Public: ask ARIA. `settings` = { aiProvider, apiKeys:{}, models:{}, searchProvider }
export async function ask(settings, history, inventory) {
  const provider = settings.aiProvider || "anthropic";
  const key   = settings.apiKeys?.[provider];
  if (!key) throw new Error(`No API key set for ${PROVIDERS[provider].label}. Open Settings to add one.`);
  const model = settings.models?.[provider] || PROVIDERS[provider].defaultModel;
  let sys     = systemPrompt(inventory);

  // optional live web search augmentation
  if (settings.searchProvider === "tavily" && settings.apiKeys?.tavily) {
    const q = [...history].reverse().find((m) => m.role === "user")?.content;
    if (q) {
      try { sys += "\n\n" + await tavilySearch(settings.apiKeys.tavily, q); }
      catch (e) { sys += `\n\n(Web search unavailable: ${e.message})`; }
    }
  }

  if (provider === "anthropic") return callAnthropic(key, model, sys, history);
  if (provider === "openai")    return callOpenAI(key, model, sys, history);
  if (provider === "google")    return callGemini(key, model, sys, history);
  if (provider === "groq")      return callGroq(key, model, sys, history);
  throw new Error(`Unknown provider: ${provider}`);
}
