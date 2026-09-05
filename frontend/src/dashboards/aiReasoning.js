/**
 * aiReasoning.js — Client-side AI reasoning engine for the E-Farm assistant.
 *
 * The engine does NOT call any external LLM API. Instead it genuinely
 * "thinks" in three lightweight stages:
 *
 *   1. Entity extraction  — pulls crops, input-types and cities out of the
 *      farmer's question.
 *   2. Intent classification — picks the dominant intent (sourcing, price,
 *      weather, scheme, pest/disease, irrigation, storage, machinery,
 *      crop-advice).
 *   3. Multi-source synthesis — cross-references the question against
 *      EVERY app data source the caller passes in (LOCAL_VENDORS,
 *      GLOBAL_SOURCES, marketplace PRODUCTS, MARKET_PRICES, GUIDES,
 *      SCHEMES, WEATHER_CODES, AI_KB) and writes a brand-new, data-grounded
 *      answer that cites the actual sources found.
 *
 * Every public symbol here is pure (no side-effects), so the caller simply
 * passes a `context` object with the live data at call-time.
 */

/* ---------- entity + intent tables ---------- */

const CROP_NAMES = [
  "wheat", "rice", "paddy", "dhan", "maize", "corn", "soybean", "soyabean",
  "cotton", "mustard", "gram", "chana", "onion", "potato", "tomato",
  "sugarcane", "ginger", "garlic",
];

const INPUT_CATEGORIES = [
  { key: "seeds",       label: "Seeds",       words: ["seed","beej","variety","hybrid","sowing"] },
  { key: "fertilizers", label: "Fertilizers", words: ["fertilizer","urea","npk","khad","compost","manure","dose","nutrient"] },
  { key: "pesticides",  label: "Pesticides",   words: ["pest","insect","pesticide","fungicide","blight","rust","disease","fungus","keeda"] },
  { key: "machinery",   label: "Machinery",   words: ["tractor","machine","equipment","implement","harvester","machinery","engine"] },
  { key: "irrigation",  label: "Irrigation",   words: ["irrigation","drip","sprinkler","pump","pani","water","drainage"] },
  { key: "tools",       label: "Tools",       words: ["tool","harrow","plow","plough","rake","pruner"] },
  { key: "storage",     label: "Storage",     words: ["storage","godown","bin","sil","keep","preserv"] },
];

const CITY_INDEX = [
  "bhopal","indore","jabalpur","ujjain","gwalior","mp","madhya pradesh",
  "delhi","mumbai","nashik",
];

const INTENT_KEYWORDS = {
  sourcing:     ["buy","source","vendor","supplier","shop","where to get","near me","purchase","dealer","wholesale","kharid","kam","se"],
  price:        ["price","rate","cost","mandi","bhav","sell","market","worth"],
  weather:      ["weather","rain","baarish","temperature","forecast","climate"],
  scheme:       ["scheme","subsidy","yojana","sarkar","pm-kisan","pmfby","pmksy","kisan credit","kusum","loan","benefit","financial"],
  pest_disease: ["pest","insect","bug","disease","blight","rust","fungus","rot","infestation","pesticide","spray"],
  irrigation:   ["irrigation","drip","sprinkler","water","pani","drainage"],
  storage:      ["storage","godown","keep","store","grain","sil","bin","preserv","moisture"],
  machinery:    ["tractor","machine","equipment","implement","harvester","machinery"],
  crop_advice:  ["grow","cultivation","plant","sow","sowing","harvest","yield","crop","variety"],
};

/* ---------- exported helpers (useful for testing) ---------- */

export const extractEntities = (q) => {
  const lower = String(q || "").toLowerCase();
  const e = { crops: [], inputs: [], cities: [] };
  for (const c of CROP_NAMES) if (lower.includes(c)) e.crops.push(c);
  for (const ci of CITY_INDEX) if (lower.includes(ci)) e.cities.push(ci.charAt(0).toUpperCase() + ci.slice(1));
  for (const ic of INPUT_CATEGORIES) if (ic.words.some((w) => lower.includes(w))) e.inputs.push(ic.label);
  e.crops = [...new Set(e.crops)];
  e.inputs = [...new Set(e.inputs)];
  e.cities = [...new Set(e.cities)];
  return e;
};

export const classifyIntent = (q) => {
  const lower = String(q || "").toLowerCase();
  let best = "general";
  let bestScore = 0;
  for (const [intent, words] of Object.entries(INTENT_KEYWORDS)) {
    const score = words.filter((w) => lower.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = intent; }
  }
  return best;
};
