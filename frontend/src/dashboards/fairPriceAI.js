// ============================================================
//  fairPriceAI.js — E-Farm AI Fair Price engine
//
//  Powers the "✨ AI Fair Price" button in My Products. It:
//    • Matches the product name (English + Hindi aliases,
//      plural forms) against the E-Farm mandi snapshot
//    • Analyses the 6-month mandi history — trend, recent
//      momentum and volatility
//    • Derives a FAIR direct-to-consumer price band
//      (budget / fair / premium) adjusted for quality cues
//      found in the description (organic, premium, loose…)
//    • Optionally enriches the analysis with the real E-Farm
//      AI (aiClient) when an API key is connected — and falls
//      back silently so the feature NEVER dead-ends.
// ============================================================

import { askEfarmAI, hasApiKey } from "./aiClient.js";

/* Mandi snapshot (₹ per quintal, 6 months oldest → newest).
   Keep in sync with the Market Prices page. */
export const MARKET_PRICES = [
  { name: "Wheat", history: [2280, 2320, 2290, 2360, 2390, 2425] },
  { name: "Paddy", history: [1750, 1780, 1770, 1795, 1800, 1820] },
  { name: "Maize", history: [1680, 1660, 1640, 1625, 1610, 1615] },
  { name: "Soybean", history: [4400, 4420, 4390, 4370, 4345, 4360] },
  { name: "Cotton", history: [5350, 5390, 5410, 5400, 5420, 5410] },
  { name: "Mustard", history: [4900, 4950, 4960, 4990, 5010, 5030] },
  { name: "Gram", history: [5100, 5140, 5170, 5160, 5190, 5205] },
  { name: "Onion", history: [1150, 1280, 1360, 1320, 1420, 1470] },
  { name: "Potato", history: [980, 1040, 1090, 1060, 1120, 1150] },
  { name: "Tomato", history: [850, 950, 1080, 1010, 1120, 1180] },
];

/* ---------- product-name → crop matching ---------- */

const CROP_ALIASES = {
  Wheat: ["wheat", "gehun", "godhuma"],
  Paddy: ["paddy", "rice", "chawal", "dhan", "basmati"],
  Maize: ["maize", "corn", "makka", "bhutta"],
  Soybean: ["soybean", "soyabean", "soya", "bhatta"],
  Cotton: ["cotton", "kapas", "rui"],
  Mustard: ["mustard", "sarson", "sarso", "rai", "rapeseed"],
  Gram: ["gram", "chana", "channa", "besan", "bengal"],
  Onion: ["onion", "pyaz", "pyaj", "kanda", "onions"],
  Potato: ["potato", "aloo", "batata", "potatoes"],
  Tomato: ["tomato", "tamatar", "tamate", "tomatoes"],
};

/* Perishables fetch a higher retail premium over mandi than
   storable staples, because consumers buy them fresh & often
   graded/packed. */
const PERISHABLE = new Set(["Onion", "Potato", "Tomato"]);

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const singular = (w) =>
  w.length > 4 && w.endsWith("es") ? w.slice(0, -2)
  : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1)
  : w;

export const matchCrop = (name) => {
  const text = " " + normalize(name) + " ";
  const words = normalize(name).split(" ").map(singular);
  for (const [crop, aliases] of Object.entries(CROP_ALIASES)) {
    for (const a of aliases) {
      if (text.includes(" " + a + " ")) return crop;
      if (words.includes(singular(a))) return crop;
    }
  }
  return null;
};

/* ---------- quality / grade cues in the description ---------- */

const QUALITY_CUES = [
  { re: /organic|jaivik|desi|chemical[- ]?free/, adj: 0.12, note: "organic/desi produce earns a premium (+12%)" },
  { re: /premium|grade[- ]?a|export|hand[- ]?picked|farm[- ]?fresh/, adj: 0.08, note: "premium grading adds value (+8%)" },
  { re: /loose|old stock|damaged|mixed|size[- ]?mixed/, adj: -0.08, note: "loose/mixed grade lowers the fair band (−8%)" },
];

/* ---------- math helpers ---------- */

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const stdevPct = (a) => {
  const m = avg(a);
  return m ? (Math.sqrt(avg(a.map((v) => (v - m) * (v - m)))) / m) * 100 : 0;
};

const roundSmart = (v) =>
  v < 20 ? Math.round(v * 2) / 2
  : v < 100 ? Math.round(v)
  : Math.round(v / 5) * 5;

/* ---------- core analysis ---------- */

export function analyzeFairPrice({ name, category, price, description, unit }) {
  const crop = matchCrop(name);
  if (!crop) return { matched: false, name };

  /* The mandi dataset is ₹/kg, so price comparison only makes
     sense when the farmer sells per kg. Legacy products (no
     unit field) are treated as per-kg produce. */
  const perKg = unit !== "unit";

  const entry = MARKET_PRICES.find((p) => p.name === crop);
  const hist = entry.history;
  const cur = hist[hist.length - 1];
  const mandiKg = Math.round((cur / 100) * 10) / 10;
  const trendPct = ((cur - hist[0]) / hist[0]) * 100;
  const momentumPct = ((cur - hist[2]) / hist[2]) * 100;
  const vol = stdevPct(hist);

  /* retail conversion: mandi wholesale → direct-to-consumer */
  let factor = PERISHABLE.has(crop) || ["Vegetables", "Fruits", "Dairy"].includes(category) ? 1.32 : 1.16;

  const bullets = [
    "📍 " + crop + " mandi rate today: **₹" + cur + "/quintal** (≈ ₹" + mandiKg + "/kg).",
  ];
  if (Math.abs(trendPct) >= 2) {
    bullets.push(
      (trendPct > 0 ? "📈 " : "📉 ") + "6-month trend: **" + (trendPct > 0 ? "+" : "") + trendPct.toFixed(1) + "%**" +
      (Math.abs(momentumPct) >= 3 ? " — " + (momentumPct > 0 ? "rising" : "softening") + " in the last 3 months (" + (momentumPct > 0 ? "+" : "") + momentumPct.toFixed(1) + "%)." : ".")
    );
  } else {
    bullets.push("➡️ Prices have stayed sideways over 6 months (" + trendPct.toFixed(1) + "%) — steady demand.");
  }
  if (vol >= 6) bullets.push("⚡ Volatility is high (" + vol.toFixed(0) + "%) — review weekly in Price Trends.");

  const desc = " " + normalize(description) + " ";
  for (const cue of QUALITY_CUES) {
    if (cue.re.test(desc)) {
      factor += cue.adj;
      bullets.push("🏷️ AI read your description: " + cue.note + ".");
    }
  }
  factor = Math.max(0.95, Math.min(1.6, factor));

  const fair = roundSmart(mandiKg * factor);
  const spread = Math.max(0.06, (vol / 100) * 0.6);
  const budget = roundSmart(fair * (1 - spread));
  const premium = roundSmart(fair * (1 + spread));

  bullets.push(perKg
    ? "💡 For direct-to-consumer sale on E-Farm (no middlemen), a fair price is around **₹" + fair + "/kg**."
    : "💡 Mandi-based reference: **₹" + fair + "/kg**. You sell per unit (piece/pack), so use it as guidance only.");

  const existing = Number(price);
  let advice = null;
  if (perKg && existing > 0) {
    const diff = ((existing - fair) / fair) * 100;
    advice = diff > 12 ? "high" : diff < -12 ? "low" : "fair";
    if (advice === "high") bullets.push("⚠️ Your price (₹" + existing + ") is " + diff.toFixed(0) + "% above the fair band — premium quality can justify it, otherwise it may slow orders.");
    else if (advice === "low") bullets.push("🟡 Your price (₹" + existing + ") is " + Math.abs(diff).toFixed(0) + "% below the fair band — you may be leaving money on the table.");
    else bullets.push("✅ Your price (₹" + existing + ") sits comfortably inside the fair band.");
  }

  return {
    matched: true, name, crop, mandiQuintal: cur, mandiKg,
    trendPct, momentumPct, volatility: vol, factor,
    budget, fair, premium, advice, bullets, unit: perKg ? "kg" : "unit",
    source: "E-Farm market engine",
  };
}

/* ---------- optional live-AI enrichment ---------- */

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export async function suggestFairPriceAI({ name, category, price, description, unit }) {
  const local = analyzeFairPrice({ name, category, price, description, unit });
  let aiText = "";
  if (hasApiKey()) {
    try {
      const q =
        "A farmer on E-Farm is listing: \"" + String(name).trim() + "\" (category: " + category + ")" +
        (description ? ". Description: " + String(description).trim() : "") + ".\n" +
        (local.matched
          ? "Today's E-Farm mandi snapshot: " + local.crop + " ₹" + local.mandiQuintal + "/quintal (₹" + local.mandiKg + "/kg), 6-month change " + local.trendPct.toFixed(1) + "%."
          : "No mandi rate is available for this item in our snapshot.") + "\n" +
        (Number(price) > 0
          ? "The farmer plans to charge ₹" + price + (unit === "unit" ? " per unit (piece/pack)." : " per kg.")
          : "No price set yet.") + "\n" +
        "In 3 short bullet points (max 15 words each), assess whether this price is fair for a direct-to-consumer sale in India and give one concrete pricing tip with ₹ numbers. No headings.";
      const out = await withTimeout(askEfarmAI({ question: q, deepThink: false }), 25000);
      if (out && out.mode === "ai" && out.text) {
        aiText = String(out.text)
          .replace(/^[•\-*]\s*/gm, "• ")
          .slice(0, 600);
      }
    } catch {
      /* live AI unavailable — local analysis already returned */
    }
  }

  return { ...local, aiText, hasKey: hasApiKey() };
}

/* ---------- lightweight badge for existing listings ---------- */

export function evaluatePrice(name, category, price, unit) {
  const r = analyzeFairPrice({ name, category, price, unit });
  if (!r.matched || !(Number(price) > 0) || !r.advice) return null;
  if (r.advice === "fair") return { cls: "green", label: "Fair price", fair: r.fair, mandiKg: r.mandiKg };
  if (r.advice === "high") return { cls: "blue", label: "Above market", fair: r.fair, mandiKg: r.mandiKg };
  return { cls: "amber", label: "Below market", fair: r.fair, mandiKg: r.mandiKg };
}

