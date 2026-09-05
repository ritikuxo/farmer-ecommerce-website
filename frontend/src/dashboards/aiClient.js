// ============================================================
//  aiClient.js — E-Farm open-source AI engine
//
//  Replaces the old keyword-only responder with a REAL AI that:
//    • answers ANY question — farming and general knowledge
//    • THINKS step-by-step (Deep Think uses reasoning models
//      like DeepSeek R1 / Qwen 3 and shows its thinking)
//    • COMPARES its answer against live reference sources
//      (Wikipedia API — free, keyless) and cites them
//
//  Provider chain — the first configured provider wins and each
//  tries several open-source models in turn (auto-failover):
//    1. OpenRouter          (free key — openrouter.ai/keys)
//    2. Groq                (free key — console.groq.com/keys)
//    3. Google AI Studio    (free key — aistudio.google.com)
//    4. No key / all failed → Reference mode:
//       E-Farm rule knowledge + live Wikipedia answer, so the
//       assistant NEVER dead-ends.
// ============================================================

import { AI_CONFIG } from "./aiConfig.js";

const ENDPOINTS = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  google: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
};

/* Open-source model chains — tried in order per provider. */
const MODEL_CHAINS = {
  openrouter: {
    fast: [
      "meta-llama/llama-3.3-70b-instruct:free",
      "deepseek/deepseek-chat-v3-0324:free",
      "qwen/qwen3-14b:free",
      "mistralai/mistral-small-3.2-24b-instruct:free",
    ],
    deep: [
      "deepseek/deepseek-r1-0528:free",
      "deepseek/deepseek-r1:free",
      "qwen/qwen3-14b:free",
    ],
  },
  groq: {
    fast: [
      "llama-3.3-70b-versatile",
      "openai/gpt-oss-120b",
      "qwen/qwen3-32b",
      "llama-3.1-8b-instant",
    ],
    deep: [
      "deepseek-r1-distill-llama-70b",
      "qwen/qwen3-32b",
      "openai/gpt-oss-120b",
    ],
  },
  google: {
    fast: ["gemma-3-27b-it", "gemini-2.0-flash"],
    deep: ["gemma-3-27b-it", "gemini-2.5-flash"],
  },
};

const PROVIDER_LABELS = {
  openrouter: "OpenRouter · open-source model",
  groq: "Groq · open-source model",
  google: "Google AI Studio · open model",
};

const SYSTEM_PROMPT = `You are the E-Farm AI Assistant — an expert, friendly assistant for farmers and consumers on the E-Farm agriculture platform.

You can answer ANY question — farming (crops, soil, pests, irrigation, mandi prices, government schemes) and also general knowledge, science, health, technology, history, maths or anything else the user asks.

How to answer:
1. THINK step by step before answering. Be accurate, practical and honest.
2. If REFERENCE SOURCES are provided, read them, use their facts, and explicitly COMPARE them with your own knowledge — note where they agree or differ, then give your best combined answer.
3. Cite the sources you used as [1], [2] matching the numbered references.
4. Format: short intro line, then "•" bullet points, bold key terms with **double asterisks**. No markdown headings, tables or links. Keep answers compact but complete.
5. For India-specific farming questions, use ₹ and per-acre units, and mention relevant government schemes when useful.
6. Match the user's language (English / Hindi / Hinglish). If you truly don't know something, say so and suggest how to verify.`;

/* ---------- low-level helpers ---------- */

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* One chat completion. Strips <think>…</think> reasoning blocks
   that reasoning models wrap around their answers. */
async function chatOnce({ endpoint, apiKey, model, messages, timeoutMs }) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (endpoint === ENDPOINTS.openrouter) {
    headers["HTTP-Referer"] =
      typeof location !== "undefined" ? location.origin : "https://e-farm.app";
    headers["X-Title"] = "E-Farm";
  }

  const res = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, temperature: 0.5 }),
    },
    timeoutMs
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} — ${body.slice(0, 140)}`);
  }

  const data = await res.json();
  const message = data?.choices?.[0]?.message || {};
  let content = String(message.content || "");
  let reasoning = String(message.reasoning || message.reasoning_content || "");

  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
  if (thinkMatch) {
    reasoning = reasoning || thinkMatch[1].trim();
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  }
  content = content.replace(/<\/?think>/gi, "").trim();

  if (!content) throw new Error("empty completion");
  return { content, reasoning };
}

/* ---------- live reference sources (free, keyless) ---------- */

/* Question words carry no search value — strip them so the
   Wikipedia query targets the actual topic. */
const SEARCH_STOP_WORDS = new Set([
  "what", "is", "are", "the", "a", "an", "how", "to", "do", "does", "did",
  "explain", "tell", "me", "about", "why", "when", "where", "which", "who",
  "can", "you", "please", "i", "my", "we", "our", "it", "its", "of", "for",
  "in", "on", "at", "by", "with", "from", "and", "or", "best", "good",
  "simple", "simply", "easily", "give", "answer", "question", "should",
  "would", "could", "will", "that", "this", "these", "those", "there",
  "some", "any", "more", "most", "very", "much", "many", "get", "got",
  "make", "made", "use", "using", "used", "need", "want", "know",
  "क्या", "कैसे", "कब", "कहाँ", "कौन", "है", "हैं", "का", "की", "के",
  "में", "से", "को", "पर", "और", "या", "बताओ",
]);

async function gatherSources(question, max = 2) {
  const clean = String(question || "")
    .replace(/[?।!.,;'"()]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 1 && !SEARCH_STOP_WORDS.has(word.toLowerCase()))
    .slice(0, 8)
    .join(" ");
  if (!clean) return [];

  try {
    const searchRes = await fetchWithTimeout(
      "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
        encodeURIComponent(clean) +
        "&srlimit=" + max + "&format=json&origin=*",
      {},
      7000
    );
    if (!searchRes.ok) return [];
    const searchJson = await searchRes.json();
    const titles = (searchJson?.query?.search || [])
      .map((item) => item.title)
      .slice(0, max);
    if (!titles.length) return [];

    const sources = await Promise.all(
      titles.map(async (title) => {
        const url =
          "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
        try {
          const extractRes = await fetchWithTimeout(
            "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&redirects=1&format=json&origin=*&titles=" +
              encodeURIComponent(title),
            {},
            7000
          );
          if (!extractRes.ok) return { title, url, text: "" };
          const extractJson = await extractRes.json();
          const page = Object.values(extractJson?.query?.pages || {})[0];
          return { title, url, text: String(page?.extract || "").slice(0, 900) };
        } catch {
          return { title, url, text: "" };
        }
      })
    );
    return sources.filter((source) => source.text);
  } catch {
    return [];
  }
}

/* ---------- key storage (browser localStorage) ----------
   The easiest path: paste a free key once in the app — no file
   editing, no restart. File keys (aiConfig.js) also work.     */

const STORAGE_KEY = "efarm_ai_key";

export const getStoredKey = () => {
  try {
    return String(localStorage.getItem(STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
};

export const setStoredKey = (key) => {
  try {
    const clean = String(key || "").trim();
    if (clean) localStorage.setItem(STORAGE_KEY, clean);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
};

const detectProvider = (key) => {
  if (key.startsWith("sk-or-")) return "openrouter";
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("AIza")) return "google";
  return "openrouter";
};

/* All usable providers, best first. */
const resolveProviders = () => {
  const found = [];
  const stored = getStoredKey();
  if (stored) found.push({ id: detectProvider(stored), key: stored });
  if (AI_CONFIG.openrouterKey) found.push({ id: "openrouter", key: AI_CONFIG.openrouterKey.trim() });
  if (AI_CONFIG.groqKey) found.push({ id: "groq", key: AI_CONFIG.groqKey.trim() });
  if (AI_CONFIG.googleKey) found.push({ id: "google", key: AI_CONFIG.googleKey.trim() });
  const seen = new Set();
  return found.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
};

export const hasApiKey = () => resolveProviders().length > 0;

/* ---------- public API ---------- */

export async function askEfarmAI({
  question,
  history = [],
  deepThink = false,
  localFallback = null,
}) {
  const cleanQuestion = String(question || "").trim();

  /* 1) Gather live reference sources for comparison. */
  const sources = await gatherSources(cleanQuestion);
  const sourceBlock = sources.length
    ? "\n\nREFERENCE SOURCES (live — read, use and COMPARE with your own knowledge; cite as [1], [2]):\n" +
      sources
        .map((s, i) => `[${i + 1}] "${s.title}": ${s.text}`)
        .join("\n\n")
    : "";

  /* 2) Build the conversation. */
  const messages = [
    { role: "system", content: SYSTEM_PROMPT + sourceBlock },
    ...history.slice(-8),
    { role: "user", content: cleanQuestion },
  ];

  /* 3) Try every configured provider / open-source model. */
  const providers = resolveProviders();

  const mode = deepThink ? "deep" : "fast";
  const timeoutMs = deepThink ? 150000 : 60000;

  for (const provider of providers) {
    for (const model of MODEL_CHAINS[provider.id][mode]) {
      try {
        const out = await chatOnce({
          endpoint: ENDPOINTS[provider.id],
          apiKey: provider.key,
          model,
          messages,
          timeoutMs,
        });
        return {
          text: out.content,
          thinking: out.reasoning,
          provider: PROVIDER_LABELS[provider.id],
          model,
          sources,
          mode: "ai",
        };
      } catch {
        /* try the next model / provider */
      }
    }
  }

  /* 4) Reference mode — no key configured or every model failed.
        Never dead-end: rule-engine answer + Wikipedia answer.
        The local engine is wrapped so it can never crash the chat. */
  let local = "";
  try {
    local = localFallback ? String(localFallback(cleanQuestion)) : "";
  } catch {
    local = "";
  }
  const ruleEngineMatched = local && !/I'm your E-Farm AI Assistant/.test(local);

  if (ruleEngineMatched) {
    return {
      text: local,
      provider: "E-Farm offline knowledge base",
      model: "rule-engine",
      sources,
      mode: "reference",
    };
  }

  if (sources.length) {
    return {
      text:
        "📖 Here's what the live reference sources say about that:\n\n" +
        sources
          .map(
            (s, i) =>
              `[${i + 1}] **${s.title}** — ${s.text.slice(0, 420)}${s.text.length > 420 ? "…" : ""}`
          )
          .join("\n\n") +
        "\n\n💡 To unlock the full open-source AI: get a free key at openrouter.ai/keys (30 seconds, no credit card) and paste it into the yellow Connect box above this chat.",
      provider: "Reference mode · Wikipedia",
      model: "-",
      sources,
      mode: "reference",
    };
  }

  return {
    text: providers.length
      ? "⚠️ The AI engine didn't respond just now — your key may be invalid or the models are busy. Please try again in a moment.\n\n💡 If it keeps failing, create a fresh key at openrouter.ai/keys and re-connect it in the yellow box above the chat."
      : "⚠️ I couldn't reach an AI engine (no key configured and no reference found).\n\n💡 Free fix — takes 30 seconds: get a key at openrouter.ai/keys and paste it into the yellow Connect box above this chat. Then I answer everything with open-source models like Llama 3.3 70B and DeepSeek R1." +
        (local ? "\n\n" + local : ""),
    provider: providers.length ? "AI engine unreachable" : "Offline",
    model: "-",
    sources: [],
    mode: "offline",
  };
}

/* Label shown in the chat header so the farmer knows the engine. */
export const activeEngineLabel = () => {
  const providers = resolveProviders();
  if (!providers.length)
    return "Reference mode — connect a free key above for full AI";
  const names = {
    openrouter: "OpenRouter",
    groq: "Groq",
    google: "Google AI Studio",
  };
  const models = {
    openrouter: "Llama 3.3 70B / DeepSeek R1",
    groq: "Llama 3.3 / DeepSeek R1 / GPT-OSS",
    google: "Gemma 3",
  };
  const p = providers[0];
  return `${names[p.id]} — ${models[p.id]} (open-source) ✅`;
};
