import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

import { auth, db } from "../firebase/config";
import { signOut } from "firebase/auth";

import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getDoc,
  setDoc,
  onSnapshot,
} from "firebase/firestore";

import "./FarmerDashboard.css";
import { MIN_ORDER_VALUE, getTripKm, calcCommission } from "./deliveryEarnings";
import LocationPicker from "../components/LocationPicker";
import { askEfarmAI, activeEngineLabel, hasApiKey, setStoredKey } from "./aiClient";
import { MARKET_PRICES, suggestFairPriceAI, evaluatePrice } from "./fairPriceAI";
import SupportChat from "../components/SupportChat";

/* =========================================================
   AI ANSWER FORMATTING — tiny safe markdown
   (escape HTML first, then bold / `code` / bullets / lines)
========================================================= */
const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const fmtAI = (raw) =>
  escapeHtml(raw)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^\s*#{1,4}\s*(.+)$/gm, "<strong>$1</strong>")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n/g, "<br/>");

/* =========================================================
   STATIC DATA
========================================================= */

const CATEGORIES = [
  { id: "Seeds", icon: "🌾", desc: "Hybrid & traditional seeds" },
  { id: "Fertilizers", icon: "🧪", desc: "NPK, urea & organic" },
  { id: "Pesticides", icon: "🐛", desc: "Crop protection" },
  { id: "Machinery", icon: "🚜", desc: "Tractors & equipment" },
  { id: "Irrigation", icon: "💧", desc: "Pumps & drip systems" },
  { id: "Tools", icon: "🛠️", desc: "Hand & power tools" },
  { id: "Storage", icon: "📦", desc: "Bins & silos" },
];
/* =========================================================
   STATIC AGRI-INPUT CATALOG
   ---------------------------------------------------------
   These are the buyable agri-inputs a farmer needs. They
   are merged into the marketplace so the Browse Products
   section (filtered by CATEGORIES) is never empty. Each
   entry has farmerId "efarm-static" so it always passes
   the "not my own product" filter.
   ========================================================= */
const AGRI_INPUTS = [
  // ---- Seeds ----
  { id: "agri-seed-1", name: "Hybrid Wheat Seed HD-2967", category: "Seeds", price: 1200, quantity: 500, description: "High-yielding, rust-resistant wheat variety. Sowing rate 40-50 kg/acre. Certified seed with 85%+ germination.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-seed-2", name: "BT Cotton Seed (BG-II)", category: "Seeds", price: 760, quantity: 300, description: "Bollworm-resistant hybrid cotton. 450-500 g/acre. Reduces pesticide sprays significantly.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-seed-3", name: "Hybrid Maize Seed (DHM-117)", category: "Seeds", price: 580, quantity: 400, description: "Single-cross hybrid maize. High yield potential. Sow 8-10 kg/acre.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-seed-4", name: "Paddy Variety IR-64", category: "Seeds", price: 95, quantity: 1000, description: "Popular medium-duration rice variety. 120-125 days. Yield 20-25 q/acre.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-seed-5", name: "Soybean Seed JS-335", category: "Seeds", price: 220, quantity: 600, description: "Certified soybean seed with Rhizobium treatment. Sow 20-25 kg/acre.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-seed-6", name: "Mustard Seed RH-749", category: "Seeds", price: 180, quantity: 350, description: "Early-maturing mustard variety. 95-100 days. Oil content 38-40%.", imageUrl: "", farmerId: "efarm-static" },
  // ---- Fertilizers ----
  { id: "agri-fert-1", name: "Urea (46% N)", category: "Fertilizers", price: 266, quantity: 2000, description: "Prilled urea, 46% nitrogen. 50 kg bag. Apply in splits for best uptake.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-fert-2", name: "DAP 18-46-0", category: "Fertilizers", price: 1350, quantity: 1500, description: "Di-ammonium phosphate. 50 kg bag. Best as basal dose at sowing.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-fert-3", name: "NPK 10-26-26", category: "Fertilizers", price: 1180, quantity: 1200, description: "Complex fertilizer for balanced nutrition. 50 kg bag. Ideal for oilseeds & pulses.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-fert-4", name: "Muriate of Potash (MOP)", category: "Fertilizers", price: 850, quantity: 1000, description: "Potassium chloride, 60% K2O. 50 kg bag. Improves grain quality & disease resistance.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-fert-5", name: "Organic Compost (Vermicompost)", category: "Fertilizers", price: 350, quantity: 800, description: "Rich organic vermicompost. 50 kg bag. Improves soil structure & water holding.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-fert-6", name: "Liquid Zinc Sulphate", category: "Fertilizers", price: 280, quantity: 500, description: "Chelated zinc 12%. 1 L bottle. Corrects zinc deficiency in rice & maize.", imageUrl: "", farmerId: "efarm-static" },
  // ---- Pesticides ----
  { id: "agri-pest-1", name: "Propiconazole 25% EC", category: "Pesticides", price: 420, quantity: 300, description: "Systemic fungicide for wheat yellow rust & rice blast. 1 mL/L water.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-pest-2", name: "Mancozeb 75% WP", category: "Pesticides", price: 320, quantity: 400, description: "Contact fungicide for late blight & leaf spot. 2.5 g/L water. Broad spectrum.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-pest-3", name: "Neem Oil (Azadirachtin 1500 ppm)", category: "Pesticides", price: 240, quantity: 600, description: "Organic pest repellent. 3-5 mL/L water. Safe for beneficial insects.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-pest-4", name: "Imidacloprid 17.8% SL", category: "Pesticides", price: 380, quantity: 350, description: "Systemic insecticide for sucking pests (aphid, jassid, whitefly). 0.3 mL/L.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-pest-5", name: "Chlorpyrifos 20% EC", category: "Pesticides", price: 290, quantity: 250, description: "Broad-spectrum insecticide for stem borer & termite. 2 mL/L water.", imageUrl: "", farmerId: "efarm-static" },
,

  // ---- Machinery ----
  { id: "agri-mach-1", name: "Power Tiller (8 HP)", category: "Machinery", price: 145000, quantity: 15, description: "8 HP diesel power tiller for tillage, puddling & inter-cultivation. 2-year warranty.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-mach-2", name: "Seed Drill (9-row)", category: "Machinery", price: 38000, quantity: 25, description: "Tractor-mounted seed drill for wheat & soybean. 9-row, adjustable spacing.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-mach-3", name: "Multi-crop Thresher", category: "Machinery", price: 65000, quantity: 10, description: "Tractor PTO-driven thresher for wheat, paddy, soybean. High cleaning efficiency.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-mach-4", name: "Brush Cutter (2-stroke)", category: "Machinery", price: 12500, quantity: 40, description: "2-stroke petrol brush cutter for weeding & grass cutting. Lightweight & durable.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-mach-5", name: "Chaff Cutter (3 HP)", category: "Machinery", price: 22000, quantity: 20, description: "Electric motor-driven chaff cutter. 2-3 ton/hour. For silage preparation.", imageUrl: "", farmerId: "efarm-static" },
  // ---- Irrigation ----
  { id: "agri-irr-1", name: "Drip Irrigation Kit (1 Acre)", category: "Irrigation", price: 28000, quantity: 30, description: "Complete drip kit: 63mm mainline, 16mm laterals, 4 LPH emitters. Covers 1 acre. PMKSY subsidy eligible.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-irr-2", name: "Sprinkler Irrigation Set", category: "Irrigation", price: 8500, quantity: 50, description: "Impact sprinkler with 20m coverage. Includes fittings & stand. Saves 30-40% water.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-irr-3", name: "Submersible Pump (3 HP)", category: "Irrigation", price: 18500, quantity: 25, description: "3 HP single-phase submersible pump. Suitable for borewell up to 150m. 1-year warranty.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-irr-4", name: "HDPE Pipe 32mm (6kg)", category: "Irrigation", price: 420, quantity: 200, description: "32mm HDPE pipe, 6 kg pressure rating. 50m coil. UV-resistant for outdoor use.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-irr-5", name: "Rain Gun Sprinkler (1 inch)", category: "Irrigation", price: 6800, quantity: 35, description: "1-inch rain gun with 25m radius. High-volume irrigation for field crops.", imageUrl: "", farmerId: "efarm-static" },
  // ---- Tools ----
  { id: "agri-tool-1", name: "Knapsack Sprayer (16L)", category: "Tools", price: 1850, quantity: 80, description: "16-liter manual knapsack sprayer. Adjustable nozzle. For pesticide & foliar application.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-tool-2", name: "Garden Pruning Shear", category: "Tools", price: 320, quantity: 150, description: "Sharp bypass pruning shear for fruit trees & vines. Ergonomic grip.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-tool-3", name: "Pickaxe (5 lb head)", category: "Tools", price: 480, quantity: 100, description: "5 lb pickaxe with fiberglass handle. For digging, breaking clods & trenching.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-tool-4", name: "Spade (Round Mouth)", category: "Tools", price: 350, quantity: 120, description: "Round-mouth spade with wooden handle. For digging, planting & soil mixing.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-tool-5", name: "Wheel Barrow (6 cu ft)", category: "Tools", price: 4200, quantity: 45, description: "6 cubic foot wheelbarrow. Pneumatic tire. For transporting soil, compost & harvest.", imageUrl: "", farmerId: "efarm-static" },
  // ---- Storage ----
  { id: "agri-store-1", name: "Hermetic Grain Bag (50 kg)", category: "Storage", price: 280, quantity: 500, description: "Airtight grain storage bag. Protects against weevils & moisture without chemicals.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-store-2", name: "Plastic Storage Bin (200L)", category: "Storage", price: 1650, quantity: 60, description: "200-liter food-grade plastic bin with lid. For grain, pulses & seed storage.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-store-3", name: "Mini Metal Silo (1 ton)", category: "Storage", price: 12500, quantity: 15, description: "1-ton capacity galvanized metal silo. Rodent-proof. With discharge chute.", imageUrl: "", farmerId: "efarm-static" },
  { id: "agri-store-4", name: "Jute Sack (50 kg)", category: "Storage", price: 45, quantity: 2000, description: "Natural jute sack for grain & pulse storage. 50 kg capacity. Breathable & eco-friendly.", imageUrl: "", farmerId: "efarm-static" },
];

const LOCAL_VENDORS = [
  { name: "Agri Store Bhopal", city: "Bhopal, MP", rating: 4.6, type: "Seeds & Fertilizers", phone: "9826011111" },
  { name: "Kisan Agro Center", city: "Indore, MP", rating: 4.4, type: "Machinery & Tools", phone: "9826022222" },
  { name: "Green Earth Supplies", city: "Jabalpur, MP", rating: 4.7, type: "Organic Inputs", phone: "9826033333" },
  { name: "Shakti Tractors", city: "Bhopal, MP", rating: 4.5, type: "Machinery", phone: "9826044444" },
  { name: "Ganga Seed House", city: "Ujjain, MP", rating: 4.3, type: "Seeds", phone: "9826066666" },
  { name: "Balaji Pesticides", city: "Gwalior, MP", rating: 4.2, type: "Pesticides", phone: "9826077777" },
];

const GLOBAL_SOURCES = [
  {
    name: "AgroMart Global",
    country: "Singapore",
    rating: 4.7,
    type: "Bulk exports",
    products: "Hybrid vegetable seeds, organic fertilizers and grain handling equipment for farm-gate prices.",
    phone: "+65 6789 1234",
    email: "sales@agromart.global",
    website: "https://www.agromart.global",
  },
  {
    name: "GreenHarvest Intl",
    country: "Netherlands",
    rating: 4.5,
    type: "Greenhouse tech",
    products: "High-performance greenhouse films, hydroponic systems and climate-control automation.",
    phone: "+31 20 555 0198",
    email: "info@greenharvest.com",
    website: "https://www.greenharvest.com",
  },
  {
    name: "AsiaFert Supplies",
    country: "Thailand",
    rating: 4.2,
    type: "Fertilizers",
    products: "Water-soluble NPK, liquid micronutrients and slow-release fertilizers for export.",
    phone: "+66 2 123 4567",
    email: "trade@asiafert.co.th",
    website: "https://www.asiafert.co.th",
  },
  {
    name: "EuroFarm Tools",
    country: "Germany",
    rating: 4.7,
    type: "Precision tools",
    products: "ISO-certified hand tools, battery-powered equipment and precision planters.",
    phone: "+49 30 555 7890",
    email: "export@eurofarm.de",
    website: "https://www.eurofarm.tools",
  },
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const SCHEMES = [
  { icon: "💰", name: "PM-KISAN", desc: "Income support of ₹6,000/year paid in 3 installments to all landholder farmers.", benefit: "₹6,000 / year", link: "https://pmkisan.gov.in" },
  { icon: "🛡️", name: "PM Fasal Bima Yojana", desc: "Affordable crop insurance against natural calamities, pests & diseases.", benefit: "2% premium (Kharif)", link: "https://pmfby.gov.in" },
  { icon: "💧", name: "PMKSY — Irrigation", desc: "Micro-irrigation subsidy for drip and sprinkler systems to save water.", benefit: "Up to 55% subsidy", link: "https://pmksy.gov.in" },
  { icon: "🚜", name: "Agri Mechanization", desc: "Subsidy on tractors, power weeders, harvesters and other machinery.", benefit: "40-50% on machines", link: "https://agrimachinery.nic.in" },
  { icon: "🏦", name: "Kisan Credit Card", desc: "Short-term crop loans up to ₹3 lakh at 4% effective interest rate.", benefit: "Loans up to ₹3L", link: "https://www.myscheme.gov.in" },
  { icon: "☀️", name: "PM-KUSUM Solar Pump", desc: "60% subsidy on solar pumps — free daytime irrigation, zero fuel cost.", benefit: "Up to 60% subsidy", link: "https://pmkusum.mnre.gov.in" },
];

const GUIDES = [
  { icon: "🌾", title: "Wheat Cultivation", tag: "Cereal", body: "Sow in mid-November after soil temp drops below 25°C. Seed rate 40-50 kg/acre. Apply full P&K basal and split urea at 21 and 45 days. Irrigate at crown root (21d), tillering (45d), jointing (60d) and grain fill (80d) stages." },
  { icon: "🌱", title: "Soybean Best Practices", tag: "Oilseed", body: "Use certified seed with Rhizobium culture. Sow on ridges during monsoon onset. Keep 30x5 cm spacing. Avoid waterlogging — soybean is highly sensitive. Harvest when 80% pods turn yellow." },
  { icon: "🐛", title: "Integrated Pest Management", tag: "Protection", body: "Start with sticky traps and pheromone traps (5/acre). Spray neem oil 3ml/L at early infestation. Use chemical pesticides only at ETL levels and rotate modes of action to prevent resistance." },
  { icon: "💧", title: "Drip Irrigation Setup", tag: "Water", body: "Drip saves 40-60% water vs flood irrigation. Mainline 63mm, laterals 16mm with 4 LPH emitters at 40cm. Fertigate weekly with water-soluble NPK. Subsidy available under PMKSY (up to 55%)." },
  { icon: "🧪", title: "Soil Health & Testing", tag: "Soil", body: "Test soil every 2 years for N-P-K, pH, OC and micronutrients. Ideal pH 6.5-7.5. Add compost 2-3 t/acre yearly. Use green manuring (dhaincha/sunhemp) before kharif to boost organic carbon." },
  { icon: "🚜", title: "Machinery Maintenance", tag: "Equipment", body: "Change engine oil every 250 hours, hydraulic oil yearly. Clean air filter weekly in dusty season. Grease PTO and lift points monthly. Store implements under shade and paint exposed metal." },
];

const AI_KB = [
  { k: ["rice", "paddy", "dhan"], a: "🌾 Rice: transplant 21-25 day old seedlings at 20x15 cm. Apply N in 3 splits (basal, tillering, panicle initiation). Keep 5cm standing water till flowering. Watch for stem borer — pheromone traps @5/acre." },
  { k: ["wheat", "gehun"], a: "🌾 Wheat: sow Nov 10-25 with 40-50 kg/acre seed. 4 key irrigations at 21, 45, 60 and 80 days. Split urea — half basal, half at tillering. Watch for yellow rust in humid Dec-Jan." },
  { k: ["fertilizer", "urea", "npk", "khad", "dose"], a: "🧪 Balanced dose (per acre): Wheat — 48kg N, 24kg P, 16kg K. Paddy — 32N, 16P, 16K. Soybean — 12N, 32P, 8K. Full P&K basal; split nitrogen into 2-3 doses for best uptake." },
  { k: ["pest", "insect", "keeda", "borer", "aphid"], a: "🐛 IPM first: yellow sticky traps, pheromone traps @5/acre, neem oil 3ml/L at early signs. For heavy infestation spray at ETL levels and rotate chemical groups. Spray early morning or late evening." },
  { k: ["irrigation", "water", "pani", "drip"], a: "💧 Drip irrigation saves 40-60% water and boosts yield 15-25%. Irrigate when soil moisture at 15cm drops below field capacity. PMKSY gives up to 55% subsidy on drip systems." },
  { k: ["soil", "ph", "mitti", "organic"], a: "🧪 Healthy soil: test every 2 years (free at KVK). Ideal pH 6.5-7.5. Add 2-3 t/acre compost yearly. Grow dhaincha/sunhemp green manure before kharif. Avoid urea overuse." },
  { k: ["subsidy", "scheme", "yojana", "sarkar"], a: "🏛️ Top schemes: PM-KISAN ₹6,000/yr • PMFBY crop insurance • PMKSY drip subsidy up to 55% • KCC loans at 4% • PM-KUSUM solar pump 60% subsidy. See the Subsidies & Schemes section for links." },
  { k: ["weather", "rain", "baarish", "forecast"], a: "{WEATHER}" },
  { k: ["market", "price", "rate", "mandi", "bhav"], a: "📈 Mandi snapshot: Wheat ₹2,425/q • Paddy ₹1,820/q • Soybean ₹4,360/q • Cotton ₹5,410/q. Open Market Prices for the full table and 6-month trends before you sell." },
  { k: ["seed", "beej", "variety", "hybrid"], a: "🌱 Seeds: buy certified seed from licensed dealers, check germination (min 80%) and treat before sowing. Kharif picks: soybean JS-335, cotton BG-II, high-yield maize hybrids." },
  { k: ["storage", "grain", "godown"], a: "📦 Storage: dry grain to 10-12% moisture, use hermetic bags or clean bins, keep below 30°C, fumigate against weevils and inspect monthly." },
  { k: ["disease", "blight", "rust", "fungus", "rot"], a: "🦠 Disease control: avoid overhead watering, ensure airflow, remove infected plants. Wheat yellow rust → Propiconazole 0.1%. Late blight → Mancozeb 2.5g/L. Follow label doses." },
  { k: ["sell", "earning", "profit", "income"], a: "💼 Boost income: sell produce directly on E-Farm (no middlemen), grade & pack well, grow off-season vegetables, add value (flour/spices). Track your produce sales in Incoming Orders." },
  { k: ["hello", "hi", "namaste", "hey"], a: "👋 Namaste! I am your AI Crop Assistant. Ask me about crops, fertilizers, pests, irrigation, weather, market prices or government schemes." },
];

const WEATHER_CODES = {
  0: ["Clear sky", "☀️"], 1: ["Mainly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Cloudy", "☁️"],
  45: ["Fog", "🌫️"], 48: ["Rime fog", "🌫️"], 51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"],
  55: ["Heavy drizzle", "🌦️"], 61: ["Light rain", "🌦️"], 65: ["Heavy rain", "🌧️"],
  71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 80: ["Showers", "🌦️"], 81: ["Showers", "🌦️"],
  82: ["Heavy showers", "⛈️"], 95: ["Thunderstorm", "⛈️"], 96: ["Storm + hail", "⛈️"], 99: ["Storm + hail", "⛈️"],
};

/* =========================================================
   AI REASONING ENGINE (client-side)
   ---------------------------------------------------------
   Genuinely "thinks": parses the farmer's question →
   classifies intent → extracts entities (crops, input
   types, cities) → cross-references EVERY app data source
   (LOCAL_VENDORS, GLOBAL_SOURCES, marketplace PRODUCTS,
   MARKET_PRICES, GUIDES, SCHEMES, WEATHER) → synthesises a
   contextual, data-grounded answer citing real sources.
   ========================================================= */

const CROP_NAMES = [
  "wheat","rice","paddy","dhan","maize","corn","soybean","soyabean",
  "cotton","mustard","gram","chana","onion","potato","tomato",
  "sugarcane","ginger","garlic",
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

const CITY_INDEX = ["bhopal","indore","jabalpur","ujjain","gwalior","mp","madhya pradesh","delhi","mumbai","nashik"];

const INTENT_KEYWORDS = {
  sourcing:     ["buy","source","vendor","supplier","shop","where to get","near me","purchase","dealer","wholesale"],
  price:        ["price","rate","cost","mandi","bhav","sell","market","worth"],
  weather:      ["weather","rain","baarish","temperature","forecast","climate"],
  scheme:       ["scheme","subsidy","yojana","sarkar","pm-kisan","pmfby","pmksy","kisan credit","kusum","loan","benefit"],
  pest_disease: ["pest","insect","bug","disease","blight","rust","fungus","rot","infestation","pesticide","spray"],
  irrigation:   ["irrigation","drip","sprinkler","water","pani","drainage"],
  storage:      ["storage","godown","keep","store","grain","sil","bin","preserv","moisture"],
  machinery:    ["tractor","machine","equipment","implement","harvester","machinery"],
  crop_advice:  ["grow","cultivation","plant","sow","sowing","harvest","yield","crop","variety"],
};

const extractEntities = (q) => {
  const e = { crops: [], inputs: [], cities: [] };
  for (const c of CROP_NAMES) if (q.includes(c)) e.crops.push(c);
  for (const ci of CITY_INDEX) if (q.includes(ci)) e.cities.push(ci.charAt(0).toUpperCase() + ci.slice(1));
  for (const ic of INPUT_CATEGORIES) if (ic.words.some((w) => q.includes(w))) e.inputs.push(ic.label);
  return e;
};

const classifyIntent = (q) => {
  let best = "general", bestScore = 0;
  for (const [intent, words] of Object.entries(INTENT_KEYWORDS)) {
    const score = words.filter((w) => q.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = intent; }
  }
  return best;
};

const findLocalVendors = (inputType, city) =>
  LOCAL_VENDORS.filter((v) => {
    const typeMatch = inputType ? v.type.toLowerCase().includes(inputType.toLowerCase()) : true;
    const cityMatch = city ? v.city.toLowerCase().includes(city.toLowerCase()) : true;
    return typeMatch && cityMatch;
  });

const findGlobalSources = (inputType) =>
  GLOBAL_SOURCES.filter((s) =>
    inputType
      ? s.type.toLowerCase().includes(inputType.toLowerCase()) ||
        (s.products || "").toLowerCase().includes(inputType.toLowerCase())
      : true
  );

const findMarketPrice = (crop) => {
  if (!crop) return null;
  const match = MARKET_PRICES.find((p) => p.name.toLowerCase().includes(crop));
  return match && match.history.length ? match.history[match.history.length - 1] : null;
};

const findGuides = (crop, input) =>
  GUIDES.filter((g) => {
    const gl = (g.title + " " + g.body).toLowerCase();
    return (crop && gl.includes(crop)) || (input && gl.includes(input.toLowerCase()));
  });

const findSchemes = (q) => {
  const lower = q.toLowerCase();
  return SCHEMES.filter(
    (s) => lower.includes(s.name.toLowerCase()) ||
      s.desc.toLowerCase().includes(lower) ||
      s.benefit.toLowerCase().includes(lower) ||
      lower.includes("subsidy") || lower.includes("yojana") || lower.includes("scheme")
  );
};

const weatherReply = (w) => {
  const cond = WEATHER_CODES[w.code] || ["Partly cloudy", "⛅"];
  if (w.loading) return "🌦️ Weather is still loading — try again in a few seconds.";
  if (w.error) return `🌦️ I could not fetch live weather right now. ${w.error}`;
  return `${cond[1]} **Weather in ${w.city || "your farm"}**: ${w.temp}°C, ${cond[0].toLowerCase()}, ` +
    `humidity ${w.humidity}%, wind ${w.wind} km/h, rain chance ${w.rain}%. ` +
    (w.rain >= 60
      ? "High rain chance — postpone spraying/urea and check drainage."
      : w.rain >= 30
        ? "Some rain likely — plan irrigation after checking the sky."
        : "Dry conditions — good day for field work, spraying and irrigation.");
};

/* AI_KB lookup — whole-word matching so short keywords like
   "ph" or "hi" can never false-match inside longer words
   (e.g. "photosynthesis" used to return the soil tip). */
const aiKbLookup = (q, weather) => {
  for (const item of AI_KB) {
    const hit = item.k.some((k) =>
      new RegExp(
        "\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b",
        "i"
      ).test(q)
    );
    if (hit) {
      if (item.a === "{WEATHER}") return weatherReply(weather);
      return item.a;
    }
  }
  return "";
};

const aiThink = (question, weather, products, currentUser) => {
  const q = String(question || "").toLowerCase().trim();

  if (!q) {
    return '🤖 Please ask me something about your farm — e.g. "where to buy drip irrigation in Bhopal", "wheat fertilizer dose", "weather this week", or "PM-KISAN scheme".';
  }

  const ent = extractEntities(q);
  const intent = classifyIntent(q);

  // 1. WEATHER
  if (intent === "weather" || q.includes("weather") || q.includes("baarish")) {
    if (weather.loading) return "🌦️ Fetching your local weather… please wait a moment and ask again.";
    return weatherReply(weather);
  }

  // 2. SCHEMES / SUBSIDY
  if (intent === "scheme") {
    const matches = findSchemes(q);
    if (matches.length) {
      const lines = matches.map((s) => s.icon + " **" + s.name + "** — " + s.desc + " Benefit: " + s.benefit).join("\n\n");
      return "🏛️ Here are the relevant government schemes:\n\n" + lines + "\n\n📚 Open any scheme in the **Subsidies & Schemes** section for full application details.";
    }
    const listed = SCHEMES.map((s) => s.icon + " " + s.name + " (" + s.benefit + ")").join("\n");
    return "🏛️ No specific scheme matched, but here are the main ones you may qualify for:\n" + listed + "\n\n📚 Visit Subsidies & Schemes for links and benefit calculators.";
  }

  // 3. SOURCING — cross-reference local vendors + global sources + marketplace products
  if (intent === "sourcing") {
    const inputType = ent.inputs[0] ||
      (q.includes("seed") ? "Seeds" :
      q.includes("fertilizer") || q.includes("urea") ? "Fertilizers" :
      q.includes("pest") || q.includes("pesticide") ? "Pesticides" :
      q.includes("irrigation") || q.includes("drip") ? "Irrigation" :
      q.includes("tractor") || q.includes("machine") ? "Machinery" : "");
    const city = ent.cities.length ? ent.cities[0] : "";

    const local = findLocalVendors(inputType, city);
    const global = findGlobalSources(inputType);
    const prods = products
      .filter((p) => p.farmerId !== currentUser)
      .filter((p) => {
        const hay = (inputType + " " + (p.name || "") + " " + (p.category || "") + " " + (p.description || "")).toLowerCase();
        return inputType ? hay.includes(inputType.toLowerCase()) : true;
      })
      .slice(0, 5);

    const parts = [];
    if (inputType && city && local.length) {
      parts.push("📍 **Local vendors in " + city + " selling " + inputType + "**:\n" +
        local.map((v) => "• " + v.name + " (" + v.city + ") — ⭐ " + v.rating + " | " + v.type + " | 📞 " + v.phone).join("\n"));
    } else if (local.length) {
      parts.push("📍 **Local vendors for " + (inputType || "inputs") + "**:\n" +
        local.map((v) => "• " + v.name + " (" + v.city + ") — ⭐ " + v.rating + " | " + v.type + " | 📞 " + v.phone).join("\n"));
    }
    if (global.length) {
      parts.push("🌍 **Global sources for " + (inputType || "agri-inputs") + "**:\n" +
        global.map((s) => "• " + s.name + " (" + s.country + ") — ⭐ " + s.rating + " | " + s.type + "\n  Products: " + s.products).join("\n"));
    }
    if (prods.length) {
      parts.push("🛒 **Marketplace listings**:\n" +
        prods.map((p) => "• " + p.name + " — ₹" + p.price + " | " + p.category + " | " + (p.farmerEmail || "local dealer")).join("\n"));
    }
    if (parts.length === 0) {
      return "🔍 I couldn't find a specific " + (inputType || "input") + " vendor yet:\n• Check **Local Sources** and **Global Sources** in your dashboard for the full catalogue.\n• Browse **Marketplace → Browse Products** and filter by category.\n• Tell me more so I can narrow it down!";
    }
    return "🔎 Here's what I found for sourcing" + (inputType ? " " + inputType : "") + (city ? " in " + city : "") + ":\n\n" +
      parts.join("\n\n") + "\n\n💡 Compare 2-3 sources for price and quality before ordering.";
  }

  // 4. PRICE / MARKET
  if (intent === "price") {
    const crop = ent.crops[0];
    const price = findMarketPrice(crop);
    if (crop && price) {
      return "📈 **" + crop.charAt(0).toUpperCase() + crop.slice(1) + "** current rate: **₹" + price + "/quintal**.\n\nView **Market Prices** for the full table and 6-month trends before you sell.";
    }
    const snapshot = MARKET_PRICES.map((p) => p.name + " ₹" + p.history[p.history.length - 1] + "/q").join(" | ");
    return "📈 Current mandi rates (per quintal):\n" + snapshot + "\n\nCheck Market Prices for the full table and price trends.";
  }

  // 5. PEST / DISEASE
  if (intent === "pest_disease") {
    const guides = findGuides(null, "pest")
      .concat(GUIDES.filter((g) => g.body.toLowerCase().includes("trap") || g.body.toLowerCase().includes("neem")));
    const guideText = guides.length
      ? guides.map((g) => "**" + g.title + "**: " + g.body).join("\n\n")
      : "Start with sticky traps + pheromone traps @5/acre. Neem oil 3ml/L at early signs. Spray at ETL levels and rotate chemical groups.";
    const cropCtx = ent.crops.length ? " For **" + ent.crops.join(", ") + "**, monitor weekly in the evening." : "";
    return "🐛 " + guideText + cropCtx + "\n\n📚 See Cultivation Guides for detailed IPM plans.";
  }

    if (intent === "irrigation") {
    const guides = findGuides(null, "Irrigation");
    const guideText = guides.length ? guides[0].body : "";
    return "💧 Drip irrigation saves 40-60% water and boosts yield 15-25%.\n\n" + guideText + "\n\n🔧 Under PMKSY you get up to 55% subsidy — see Subsidies & Schemes to apply.";
  }

  // 7. STORAGE
  if (intent === "storage") {
    const guide = GUIDES.find((g) => g.title.toLowerCase().includes("storage") || g.tag.toLowerCase().includes("storage"));
    const guideText = guide ? guide.body : "Dry grain to 10-12% moisture, use hermetic bags or clean bins, keep below 30°C, fumigate against weevils, inspect monthly.";
    return "📦 " + guideText + "\n\n💡 Sell surplus directly on E-Farm Marketplace to avoid storage costs.";
  }

  // 8. MACHINERY
  if (intent === "machinery") {
    const localMachines = findLocalVendors("Machinery");
    const scheme = SCHEMES.find((s) => s.name.toLowerCase().includes("mechaniz"));
    const parts = [];
    if (localMachines.length) {
      parts.push("🔧 **Local machinery suppliers**:\n" +
        localMachines.map((v) => "• " + v.name + " (" + v.city + ") — ⭐ " + v.rating + " | " + v.type + " | 📞 " + v.phone).join("\n"));
    }
    if (scheme) parts.push("💰 **" + scheme.name + "**: " + scheme.benefit + " — " + scheme.desc);
    return parts.length
      ? "🚜 Here's what I found for machinery:\n\n" + parts.join("\n\n")
      : "🚜 Check Local Sources for tractors & equipment, and the Agri Mechanization scheme for subsidies.";
  }

  // 9. CROP ADVICE — cross-reference guides + market prices + vendors
  if (intent === "crop_advice" || ent.crops.length) {
    const crop = ent.crops[0] || null;
    const guides = crop ? findGuides(crop, null) : [];
    const kbMatch = crop
      ? AI_KB.find((item) => item.k.some((k) => k.toLowerCase().includes(crop)))
      : null;

    const parts = [];
    if (guides.length) parts.push(...guides.map((g) => "**" + g.title + "**: " + g.body));
    if (kbMatch && kbMatch.a !== "{WEATHER}") {
      parts.push("🌱 **" + (crop ? crop.charAt(0).toUpperCase() + crop.slice(1) : "Crop") + " tip**: " + kbMatch.a);
    }
    const price = crop ? findMarketPrice(crop) : null;
    if (price && crop) parts.push("📈 **" + crop.charAt(0).toUpperCase() + crop.slice(1) + "** mandi: ₹" + price + "/q");

    const cropVendors = crop ? findLocalVendors(crop.charAt(0).toUpperCase() + crop.slice(1)).slice(0, 3) : [];
    if (cropVendors.length) {
      parts.push("📍 Nearby sources:\n" +
        cropVendors.map((v) => "• " + v.name + " (" + v.city + ") — " + v.type).join("\n"));
    }

    if (parts.length) {
      return "🌾 Here's what I found for **" + (crop ? crop.charAt(0).toUpperCase() + crop.slice(1) : "crop advice") + "**:\n\n" + parts.join("\n\n");
    }
    const guideList = GUIDES.map((g) => g.icon + " " + g.title + " (" + g.tag + ")").join("\n");
    return "🌱 I have cultivation guides for:\n" + guideList + "\n\nWhich crop are you working on? I can give specific advice.";
  }

  // 10. FALLBACK — keyword match against AI_KB
  const kbAnswer = aiKbLookup(q, weather);
  if (kbAnswer) return kbAnswer;

  return "🤖 I'm your E-Farm AI Assistant. I can help you:\n• **Buy inputs** — ask \"where to buy drip kit in Bhopal\"\n• **Crop advice** — ask \"wheat fertilizer dose\" or \"pest control for soybean\"\n• **Market prices** — ask \"today's wheat rate\"\n• **Weather** — ask \"weather this week\"\n• **Schemes** — ask \"PM-KISAN\" or \"drip subsidy\"\n• **Storage & machinery** — ask \"best grain storage\" or \"tractor rent\"\n\nWhat would you like to know?";
};



const NAV = [
  { group: "MAIN", items: [{ id: "dashboard", label: "Dashboard", icon: "grid" }] },
  { group: "MARKETPLACE", items: [
    { id: "browse", label: "Browse Products", icon: "cart" },
    { id: "categories", label: "Categories", icon: "tag" },
    { id: "compare", label: "Compare Products", icon: "scale" },
    { id: "sources", label: "Local Sources", icon: "pin" },
    { id: "global", label: "Global Sources", icon: "globe" },
  ]},
  { group: "MARKET INSIGHTS", items: [
    { id: "prices", label: "Market Prices", icon: "chart" },
    { id: "trends", label: "Price Trends", icon: "trend" },
    { id: "seasonal", label: "Seasonal Insights", icon: "leaf" },
  ]},
  { group: "MY STORE", items: [
    { id: "myproducts", label: "My Products", icon: "box" },
    { id: "incoming", label: "Incoming Orders", icon: "inbox" },
  ]},
  { group: "ORDERS & TRACKING", items: [
    { id: "myorders", label: "My Orders", icon: "receipt" },
    { id: "track", label: "Track Orders", icon: "truck" },
    { id: "saved", label: "Saved Items", icon: "heart" },
  ]},
  { group: "TOOLS & RESOURCES", items: [
    { id: "calendar", label: "Crop Calendar", icon: "clock" },
    { id: "guides", label: "Farming Guides", icon: "leaf" },
    { id: "schemes", label: "Subsidies & Schemes", icon: "wallet" },
    { id: "weather", label: "Weather Updates", icon: "cloud" },
    { id: "ai", label: "AI Crop Assistant", icon: "bot" },
    { id: "location", label: "Location Settings", icon: "settings" },
  ]},
];

const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

/* Display suffixes for the product selling unit ("kg" | "unit").
   Legacy products saved before units existed have no unit field. */
const unitSuffixOf = (u) => (u === "kg" ? "/kg" : u === "unit" ? "/unit" : "");
const qtyUnitOf = (u) => (u === "kg" ? " kg" : u === "unit" ? " units" : "");

const ratingOf = (id) => 3.8 + ((String(id).split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 11)) / 10;

const STORE_CATEGORIES = ["Vegetables", "Fruits", "Grains", "Pulses", "Dairy", "Other"];

const dayStart = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.getTime() / 1000;
};

/* =========================================================
   ICONS (inline stroke icons)
========================================================= */

const ICONS = {
  menu: <><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
  cart: <><circle cx="9" cy="20.5" r="1.4" /><circle cx="18" cy="20.2" r="1.5" /><path d="M2 3h2.5l2.6 12.3a1.8 1.8 0 0 0 1.8 1.5h8.9a1.8 1.8 0 0 0 1.8-1.4L22 7H6" /></>,
  tag: <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" /><circle cx="7" cy="7" r="1.6" /></>,
  scale: <><path d="M12 3v16M8 21h8M7 6l-3.2 6.4a3.4 3.4 0 0 0 6.4 0L8 6zM16 6l-3.2 6.4a3.4 3.4 0 0 0 6.4 0L16 6zM4 6h16" /></>,
  pin: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></>,
  globe: <><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M18 17V9M13 17V5M8 17v-3" /></>,
  trend: <><path d="M22 7l-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></>,
  leaf: <><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" /><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" /></>,
  box: <><path d="M21 8v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></>,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  receipt: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8" /></>,
  truck: <><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M15 18H9" /><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" /><circle cx="17" cy="18" r="2" /><circle cx="7" cy="18" r="2" /></>,
  heart: <><path d="M20.8 4.6a5.5 5.5 0 0 0-7.7 0L12 5.6l-1.1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l8.8-8.6 1-1a5.5 5.5 0 0 0 0-7.8z" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  cloud: <><path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  drop: <><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" /></>,
  wind: <><path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <><path d="M5 12h14" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" /></>,
  x: <><path d="M18 6 6 18M6 6l12 12" /></>,
  chevL: <><path d="M15 18l-6-6 6-6" /></>,
  chevR: <><path d="M9 18l6-6-6-6" /></>,
  chevD: <><path d="M6 9l6 6 6-6" /></>,
  arrowR: <><path d="M5 12h14M12 5l7 7-7 7" /></>,
  phone: <><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.5 19.5 0 0 1 2.1 12 2.2 2.2 0 0 1 4 9.8h3.2a2 2 0 0 1 2 1.7l.3 1.5a2 2 0 0 0 .9 1.4l1 .8a19.7 19.7 0 0 0 3.4 2.4l1.5.6a2 2 0 0 0 1.7-.3l1-.8a2 2 0 0 1 2-.3z" /></>,
  edit: <><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></>,
  wallet: <><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4z" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  settings: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
  alert: <><path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="10" /></>,
  send: <><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></>,
  check: <><path d="M20 6 9 17l-5-5" /></>,
  bot: <><rect x="5" y="9" width="14" height="10" rx="3" /><path d="M12 9V4M8 4h8M2 13h3M19 13h3" /><circle cx="9.5" cy="14" r="1.2" fill="currentColor" stroke="none" /><circle cx="14.5" cy="14" r="1.2" fill="currentColor" stroke="none" /></>,
};

function Ic({ name, size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

function Sparkline({ data, up }) {
  const w = 64, h = 26, pad = 3;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) =>
    `${pad + (i * (w - pad * 2)) / (data.length - 1)},${h - pad - ((v - min) / range) * (h - pad * 2)}`
  ).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none"
        stroke={up ? "#16a34a" : "#dc2626"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Stars({ value }) {
  const r = Math.round(value);
  return (
    <span className="fd-stars">
      <span className="on">{"★".repeat(r)}</span>
      <span className="off">{"★".repeat(5 - r)}</span>
      <span className="num">{Number(value).toFixed(1)}</span>
    </span>
  );
}

/* =========================================================
   FARMER DASHBOARD
========================================================= */

function FarmerDashboard() {
  const navigate = useNavigate();
  const currentUser = auth.currentUser;

  /* ---------- NAV / UI STATE ---------- */

  const [activeSection, setActiveSection] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseCategory, setBrowseCategory] = useState("all");
  const [browseSort, setBrowseSort] = useState("new");
  const [cartOpen, setCartOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [seasonFilter, setSeasonFilter] = useState("This Season");
  const [trendCommodity, setTrendCommodity] = useState(MARKET_PRICES[0].name);
  const [toasts, setToasts] = useState([]);

  /* ---------- CART / SAVED / COMPARE (persisted) ---------- */

  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem("efarm_cart") || "[]"); } catch { return []; }
  });
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem("efarm_saved") || "[]"); } catch { return []; }
  });
  const [compare, setCompare] = useState([]);
  const [localInputOrders, setLocalInputOrders] = useState(() => {
    try { return JSON.parse(localStorage.getItem("efarm_input_orders") || "[]"); } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem("efarm_cart", JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem("efarm_saved", JSON.stringify(saved));
  }, [saved]);

  /* ---------- DATA STATE ---------- */

  const [profile, setProfile] = useState({});
  const [products, setProducts] = useState([]);
  const [incomingOrders, setIncomingOrders] = useState([]);
  const [inputOrders, setInputOrders] = useState([]);

  /* Cleared history is hidden LOCALLY only (localStorage) —
     Firestore documents are never deleted, so the consumer and
     the delivery partner keep their records. */
  const [hiddenHistoryIds, setHiddenHistoryIds] = useState(() => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return [];
      const saved = localStorage.getItem(`efarm_farmer_history_${uid}`);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const persistHiddenHistory = (ids) => {
    setHiddenHistoryIds(ids);
    try {
      const uid = auth.currentUser?.uid;
      if (uid) {
        localStorage.setItem(`efarm_farmer_history_${uid}`, JSON.stringify(ids));
      }
    } catch { /* storage unavailable — hide for this session only */ }
  };

  const visibleIncomingOrders = incomingOrders.filter(
    (o) => !hiddenHistoryIds.includes(o.id)
  );

  const [weather, setWeather] = useState({
    loading: true,
    error: "",
    temp: null,
    humidity: null,
    wind: null,
    rain: null,
    code: 2,
    city: "",
    daily: [],
  });

  /* ---------- CART / CHECKOUT ---------- */

  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [buyerCity, setBuyerCity] = useState("");
  const [buyerPincode, setBuyerPincode] = useState("");
  const [placingOrder, setPlacingOrder] = useState(false);

  /* ---------- MY PRODUCTS ---------- */

  const [productName, setProductName] = useState("");
  const [productCategory, setProductCategory] = useState("Vegetables");
  const [productPrice, setProductPrice] = useState("");
  const [productQty, setProductQty] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [productImg, setProductImg] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [aiPriceLoading, setAiPriceLoading] = useState(false);
  const [aiPriceResult, setAiPriceResult] = useState(null);
  const [productUnit, setProductUnit] = useState("kg");

  /* ---------- LOCATION ---------- */

  const [locAddress, setLocAddress] = useState("");
  const [locCity, setLocCity] = useState("");
  const [locState, setLocState] = useState("");
  const [locPincode, setLocPincode] = useState("");
  const [locLat, setLocLat] = useState("");
  const [locLng, setLocLng] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);

  /* ---------- INCOMING ORDERS ---------- */

  const [updatingOrder, setUpdatingOrder] = useState("");

  /* ---------- AI ASSISTANT ---------- */

  const [aiMessages, setAiMessages] = useState([
    { role: "bot", text: "👋 Namaste! I am your AI assistant — real open-source AI that can answer ANYTHING: crops, fertilizers, pests, mandi prices, schemes… or any general question at all. Toggle 🧠 Deep Think for step-by-step reasoning with sources." },
  ]);
  const [aiInput, setAiInput] = useState("");
  const [aiTyping, setAiTyping] = useState(false);
  const [aiDeep, setAiDeep] = useState(false);
  const [aiKeyInput, setAiKeyInput] = useState("");
  const aiEndRef = useRef(null);

  /* ---------- MONTH / TREND ---------- */

  const [calMonth, setCalMonth] = useState(MONTHS[new Date().getMonth()]);
  const [openGuide, setOpenGuide] = useState(null);

  /* ---------- TOASTS ---------- */

  const toast = (text, kind = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 3200);
  };

  /* ---------- NAVIGATION ---------- */

  const go = (section) => {
    setActiveSection(section);
    setSidebarOpen(false);
    setNotifOpen(false);
    setProfileOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goBrowse = (cat = "all") => {
    setBrowseCategory(cat);
    go("browse");
  };

  /* =========================================================
     DATA EFFECTS
  ========================================================= */

  useEffect(() => {
    const loadAll = async () => {
      if (!currentUser) {
        return;
      }

      try {
        /* PROFILE */
        const userSnap = await getDoc(doc(db, "users", currentUser.uid));
        if (userSnap.exists()) {
          const d = userSnap.data();
          setProfile(d);
          setBuyerName(d.name || "");
          setBuyerPhone(d.phone || "");
          setBuyerAddress(d.address || "");
          setBuyerCity(d.city || "");
          setBuyerPincode(d.pincode || "");
          setLocAddress(d.address || "");
          setLocCity(d.city || "");
          setLocState(d.state || "");
          setLocPincode(d.pincode || "");
          if (d.location) {
            setLocLat(String(d.location.latitude ?? ""));
            setLocLng(String(d.location.longitude ?? ""));
          }
        }

        /* ALL PRODUCTS (marketplace) */
        const prodSnap = await getDocs(collection(db, "products"));
        const prodList = prodSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setProducts(prodList);

        /* INCOMING ORDERS (my produce) — two sources merged:
           1. single-product orders → top-level farmerId == me
           2. cart orders → top-level farmerIds array contains me
              (cart checkout creates ONE order shared by all
              farmers involved, so it has no single farmerId)   */
        const oq = query(
          collection(db, "orders"),
          where("farmerId", "==", currentUser.uid)
        );
        const cq = query(
          collection(db, "orders"),
          where("farmerIds", "array-contains", currentUser.uid)
        );
        const [ordSnap, cartSnap] = await Promise.all([getDocs(oq), getDocs(cq)]);
        const byId = new Map();
        ordSnap.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
        cartSnap.forEach((d) => {
          if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...d.data() });
        });
        const ordList = [...byId.values()].sort(
          (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
        );
        setIncomingOrders(ordList);

        /* MY INPUT PURCHASES */
        try {
          const iq = query(
            collection(db, "inputOrders"),
            where("buyerId", "==", currentUser.uid)
          );
          const inSnap = await getDocs(iq);
          setInputOrders(inSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        } catch {
          /* rules may deny new collection — local storage fallback used */
        }
      } catch (err) {
        console.error("DASHBOARD LOAD ERROR:", err);
        toast("Some data could not load. Please refresh.", "err");
      }
    };

    loadAll();
  }, []);

  /* INCOMING ORDERS — real-time. The moment a delivery partner
     marks an order delivered, this snapshot fires and the farmer
     sees "your product reached the consumer successfully" without
     needing to refresh. Mirrors the two-source merge in loadAll
     (farmerId == me  OR  farmerIds array-contains me).

     Refs live at top level (Rules of Hooks); only .current is
     written inside the effect.                                      */
  const incomingOrdDocs = useRef([]);
  const incomingCartDocs = useRef([]);

  useEffect(() => {
    if (!currentUser) return undefined;

    const oq = query(
      collection(db, "orders"),
      where("farmerId", "==", currentUser.uid)
    );
    const cq = query(
      collection(db, "orders"),
      where("farmerIds", "array-contains", currentUser.uid)
    );

    const merge = () => {
      const byId = new Map();
      incomingOrdDocs.current.forEach((d) =>
        byId.set(d.id, { id: d.id, ...d.data() })
      );
      incomingCartDocs.current.forEach((d) => {
        if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...d.data() });
      });
      setIncomingOrders(
        [...byId.values()].sort(
          (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
        )
      );
    };

    const unsubOrd = onSnapshot(
      oq,
      (snap) => {
        incomingOrdDocs.current = snap.docs;
        merge();
      },
      () => {
        /* rules may deny — keep last known list */
      }
    );
    const unsubCart = onSnapshot(
      cq,
      (snap) => {
        incomingCartDocs.current = snap.docs;
        merge();
      },
      () => {}
    );

    return () => {
      unsubOrd();
      unsubCart();
    };
  }, []);

  /* ---------- WEATHER (Open-Meteo, no API key) ---------- */

  const loadWeather = async (lat, lon, cityLabel) => {
    try {
      setWeather((w) => ({ ...w, loading: true, error: "" }));
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
        `&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min,weather_code` +
        `&forecast_days=7&timezone=auto`;
      const res = await fetch(url);
      const data = await res.json();
      const cur = data.current || {};
      const daily = data.daily || {};
      setWeather({
        loading: false,
        error: "",
        temp: Math.round(cur.temperature_2m ?? 0),
        humidity: Math.round(cur.relative_humidity_2m ?? 0),
        wind: Math.round(cur.wind_speed_10m ?? 0),
        rain: Math.round(daily.precipitation_probability_max?.[0] ?? 0),
        code: cur.weather_code ?? 2,
        city: cityLabel,
        daily: (daily.time || []).map((t, i) => ({
          date: t,
          max: Math.round(daily.temperature_2m_max?.[i] ?? 0),
          min: Math.round(daily.temperature_2m_min?.[i] ?? 0),
          rain: Math.round(daily.precipitation_probability_max?.[i] ?? 0),
          code: daily.weather_code?.[i] ?? 0,
        })),
      });
    } catch {
      setWeather((w) => ({ ...w, loading: false, error: "Weather unavailable. Check your internet." }));
    }
  };

  useEffect(() => {
    const lat = Number(locLat) || 23.2599;
    const lon = Number(locLng) || 77.4126;
    const city = profile.city || locCity || "Bhopal, Madhya Pradesh";
    loadWeather(lat, lon, city);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locLat, locLng]);

  /* =========================================================
     DERIVED DATA
  ========================================================= */

  const myProducts = products.filter((p) => p && p.farmerId === currentUser?.uid);
  // A farmer must never buy their own produce — exclude own products from
  // every marketplace / buyable listing (Browse, Recommended, Saved, Compare).
  // Static AGRI_INPUTS are always included (farmerId "efarm-static" never matches a real user).
  const marketplaceProducts = [
    ...products.filter((p) => p && p.farmerId !== currentUser?.uid),
    ...AGRI_INPUTS,
  ];

  const filteredProducts = marketplaceProducts
    .filter((p) => p && (browseCategory === "all" ? true : (p.category || "") === browseCategory))
    .filter((p) => {
      if (!p) return false;
      const q = browseQuery.trim().toLowerCase();
      if (!q) return true;
      return (p.name || "").toLowerCase().includes(q) ||
             (p.category || "").toLowerCase().includes(q) ||
             (p.description || "").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (browseSort === "low") return Number(a.price || 0) - Number(b.price || 0);
      if (browseSort === "high") return Number(b.price || 0) - Number(a.price || 0);
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });

  const inStock = marketplaceProducts.filter((p) => p && p.inStock !== false && Number(p.quantity) > 0 && p.name);
  const recommended = inStock.slice(0, 10);

  const allInputOrders = [...inputOrders, ...localInputOrders]
    .sort((a, b) => (b.createdAt?.seconds || b.placedAtSec || 0) - (a.createdAt?.seconds || b.placedAtSec || 0));

  const rangeDays = seasonFilter === "This Month" ? 30 : seasonFilter === "This Season" ? 90 : 3650;
  const startSec = dayStart(rangeDays);

  const ordersInRange = incomingOrders.filter((o) => (o.createdAt?.seconds || 0) >= startSec);
  const spendInRange = allInputOrders
    .filter((o) => (o.createdAt?.seconds || o.placedAtSec || 0) >= startSec)
    .reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

  const activeTracking = incomingOrders.filter(
    (o) => o.status === "accepted" || (o.status === "pending" && (o.createdAt?.seconds || 0) >= startSec)
  ).length;

  const cartCount = cart.reduce((n, i) => n + Number(i.qty || 0), 0);
  const cartTotal = cart.reduce((n, i) => n + Number(i.price || 0) * Number(i.qty || 0), 0);

  /* ---------- NOTIFICATIONS (derived) ---------- */

  const notifications = [
    ...incomingOrders
      .filter((o) => o.status === "pending")
      .slice(0, 5)
      .map((o) => ({
        id: "np-" + o.id,
        icon: "inbox",
        title: "New order received",
        text: `${o.consumerName || "A consumer"} ordered ${o.productName || "produce"} (${o.quantity || "?"}) — respond now.`,
        section: "incoming",
      })),
    ...myProducts
      .filter((p) => Number(p.quantity) <= 5)
      .slice(0, 3)
      .map((p) => ({
        id: "ns-" + p.id,
        icon: "box",
        title: "Low stock alert",
        text: `${p.name} has only ${p.quantity} left. Restock soon.`,
        section: "myproducts",
      })),
    ...(inputOrders.length + localInputOrders.length === 0
      ? [{ id: "welcome", icon: "leaf", title: "Welcome to E-Farm", text: "Explore agri-inputs, market prices and weather tools.", section: "browse" }]
      : []),
  ];

  const readNotifs = (() => {
    try { return JSON.parse(localStorage.getItem("efarm_notif_read") || "[]"); } catch { return []; }
  })();

  const unreadNotifs = notifications.filter((n) => !readNotifs.includes(n.id));

  const markNotifsRead = () => {
    localStorage.setItem("efarm_notif_read", JSON.stringify(notifications.map((n) => n.id)));
    setNotifOpen(false);
  };

  /* ---------- CART HANDLERS ---------- */

  const addToCart = (p) => {
    if (!p) return;
    setCart((prev) => {
      const found = prev.find((i) => i.productId === p.id);
      if (found) {
        return prev.map((i) =>
          i.productId === p.id ? { ...i, qty: Math.min(Number(i.qty) + 1, 99) } : i
        );
      }
      return [...prev, {
        key: p.id,
        productId: p.id,
        name: p.name || "Product",
        price: Number(p.price || 0),
        art: categoryIconOf(p.category),
        img: p.imageUrl || "",
        qty: 1,
      }];
    });
    toast(`${p.name} added to cart 🛒`);
  };

  const changeQty = (key, delta) => {
    setCart((prev) =>
      prev
        .map((i) => (i.key === key ? { ...i, qty: Number(i.qty) + delta } : i))
        .filter((i) => i.qty > 0)
    );
  };

  const removeFromCart = (key) => {
    setCart((prev) => prev.filter((i) => i.key !== key));
  };

  const toggleSave = (id) => {
    setSaved((prev) => {
      if (prev.includes(id)) {
        toast("Removed from saved items");
        return prev.filter((x) => x !== id);
      }
      toast("Added to saved items ❤️");
      return [...prev, id];
    });
  };

  const toggleCompare = (id) => {
    setCompare((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) {
        toast("You can compare up to 3 products", "err");
        return prev;
      }
      toast("Added to comparison");
      return [...prev, id];
    });
  };

  const savedProducts = saved
    .map((id) => marketplaceProducts.find((p) => p.id === id))
    .filter(Boolean);

  const compareProducts = compare
    .map((id) => marketplaceProducts.find((p) => p.id === id))
    .filter(Boolean);

  const categoryIconOf = (cat) => {
    const c = CATEGORIES.find((x) => x.id === cat);
    return c ? c.icon : "🌿";
  };

  useEffect(() => {
    localStorage.setItem("efarm_input_orders", JSON.stringify(localInputOrders));
  }, [localInputOrders]);

  /* =========================================================
     CHECKOUT — place input purchase order
  ========================================================= */

  const placeInputOrder = async () => {
    if (cart.length === 0) { toast("Your cart is empty", "err"); return; }
    if (cartTotal < MIN_ORDER_VALUE) {
      toast(`Minimum order value is ${rupee(MIN_ORDER_VALUE)} — add ${rupee(MIN_ORDER_VALUE - cartTotal)} more`, "err");
      return;
    }
    if (!buyerName.trim() || !buyerPhone.trim() || !buyerAddress.trim()) {
      toast("Please fill name, phone and address", "err");
      return;
    }

    setPlacingOrder(true);

    const orderData = {
      buyerId: currentUser.uid,
      buyerName: buyerName.trim(),
      buyerEmail: currentUser.email || "",
      buyerPhone: buyerPhone.trim(),
      address: buyerAddress.trim(),
      city: buyerCity.trim(),
      pincode: buyerPincode.trim(),
      items: cart.map((i) => ({ productId: i.productId, name: i.name, price: i.price, qty: Number(i.qty) })),
      itemCount: cartCount,
      totalAmount: cartTotal,
      paymentMethod: "Cash on Delivery",
      paymentStatus: "pending",
      status: "processing",
      createdAt: serverTimestamp(),
    };

    try {
      const ref = await addDoc(collection(db, "inputOrders"), orderData);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        setInputOrders((prev) => [{ id: ref.id, ...snap.data() }, ...prev]);
      }
      toast("Order placed successfully! 🎉");
    } catch {
      const localOrder = {
        ...orderData,
        id: "local-" + Date.now(),
        createdAt: { seconds: Math.floor(Date.now() / 1000) },
      };
      setLocalInputOrders((prev) => [localOrder, ...prev]);
      toast("Order placed (saved on this device) 🎉");
    } finally {
      setCart([]);
      setCartOpen(false);
      setPlacingOrder(false);
    }
  };

  /* =========================================================
     AI CROP ASSISTANT
  ========================================================= */

  const saveAiKey = () => {
    const key = aiKeyInput.trim();
    if (!key) {
      toast("Paste your API key first", "err");
      return;
    }
    setStoredKey(key);
    setAiKeyInput("");
    toast("AI connected ✅ — now ask me anything!");
  };

  const askAI = async (preset) => {
    const q = String(preset ?? aiInput).trim();
    if (!q || aiTyping) return;
    setAiMessages((m) => [...m, { role: "me", text: q }]);
    setAiInput("");
    setAiTyping(true);

    try {
      const result = await askEfarmAI({
        question: q,
        deepThink: aiDeep,
        history: aiMessages
          .filter((m) => m.role === "me" || m.role === "bot")
          .slice(-8)
          .map((m) => ({
            role: m.role === "me" ? "user" : "assistant",
            content: m.text,
          })),
        localFallback: (question) =>
          aiThink(question, weather, marketplaceProducts, currentUser?.uid || null),
      });

      setAiMessages((m) => [
        ...m,
        {
          role: "bot",
          text: result.text,
          thinking: result.thinking || "",
          provider: result.provider || "",
          model: result.model || "",
          sources: result.sources || [],
        },
      ]);
    } catch (err) {
      console.error("AI ASSISTANT ERROR:", err);
      setAiMessages((m) => [
        ...m,
        {
          role: "bot",
          text: "⚠️ Something went wrong while reaching the AI engine. Please check your internet and try again.",
          provider: "error",
          sources: [],
        },
      ]);
    } finally {
      setAiTyping(false);
    }
  };

  useEffect(() => {
    if (aiEndRef.current) {
      aiEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [aiMessages, aiTyping, activeSection]);

  /* =========================================================
     MY PRODUCTS CRUD (Firestore "products")
  ========================================================= */

  const refreshProducts = async () => {
    try {
      const snap = await getDocs(collection(db, "products"));
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setProducts(list);
    } catch (err) {
      console.error("PRODUCT REFRESH ERROR:", err);
    }
  };

  const saveProduct = async () => {
    if (!productName.trim() || !productPrice || !productQty) {
      toast("Please fill name, price and quantity", "err");
      return;
    }
    const numericPrice = Number(productPrice);
    const numericQuantity = Number(productQty);
    if (Number.isNaN(numericPrice) || numericPrice < 0 || Number.isNaN(numericQuantity) || numericQuantity < 0) {
      toast("Enter valid price and quantity", "err");
      return;
    }

    setSavingProduct(true);
    try {
      const productData = {
        farmerId: currentUser.uid,
        farmerEmail: currentUser.email || "",
        farmerName: profile.name || currentUser.displayName || "",
        name: productName.trim(),
        category: productCategory,
        price: numericPrice,
        unit: productUnit,
        quantity: numericQuantity,
        description: productDesc.trim(),
        imageUrl: productImg.trim(),
        inStock: numericQuantity > 0,
        updatedAt: serverTimestamp(),
      };

      if (editingId) {
        await updateDoc(doc(db, "products", editingId), productData);
        toast("Product updated ✅");
      } else {
        await addDoc(collection(db, "products"), { ...productData, createdAt: serverTimestamp() });
        toast("Product added ✅");
      }

      setProductName(""); setProductPrice(""); setProductQty(""); setProductDesc(""); setProductImg("");
      setProductUnit("kg");
      setEditingId(null);
      setAiPriceResult(null);
      await refreshProducts();
    } catch (err) {
      console.error("PRODUCT SAVE ERROR:", err);
      toast(err?.message || "Unable to save product", "err");
    } finally {
      setSavingProduct(false);
    }
  };

  const startEditProduct = (p) => {
    setEditingId(p.id);
    setProductName(p.name || "");
    setProductCategory(p.category || "Vegetables");
    setProductPrice(String(p.price || ""));
    setProductUnit(p.unit || "kg");
    setProductQty(String(p.quantity || ""));
    setProductDesc(p.description || "");
    setProductImg(p.imageUrl || "");
    setAiPriceResult(null);
    go("myproducts");
  };

  /* ---------- AI FAIR PRICE ---------- */

  const runFairPriceAI = async () => {
    if (!productName.trim()) {
      toast("Type the product name first", "err");
      return;
    }
    setAiPriceLoading(true);
    try {
      const res = await suggestFairPriceAI({
        name: productName,
        category: productCategory,
        price: productPrice,
        description: productDesc,
        unit: productUnit,
      });
      setAiPriceResult(res);
      if (!res.matched && !res.aiText) {
        toast("No mandi rate found for this product — try a common crop name", "err");
      }
    } catch {
      toast("AI price analysis failed. Try again.", "err");
    } finally {
      setAiPriceLoading(false);
    }
  };

  const applyAiPrice = (v) => {
    setProductPrice(String(v));
    toast("Fair price applied ✨");
  };

  const deleteProduct = async (id) => {
    if (!window.confirm("Remove this product from your store?")) return;
    try {
      await deleteDoc(doc(db, "products", id));
      setProducts((prev) => prev.filter((p) => p.id !== id));
      toast("Product removed 🗑️");
    } catch (err) {
      toast(err?.message || "Unable to delete product", "err");
    }
  };

  /* =========================================================
     INCOMING ORDERS — accept / reject / delivered / remove
  ========================================================= */

  const doUpdateStatus = async (orderId, newStatus, extra = {}) => {
    setUpdatingOrder(orderId);
    try {
      await updateDoc(doc(db, "orders", orderId), {
        status: newStatus,
        farmerResponseAt: serverTimestamp(),
        ...extra,
      });
      setIncomingOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
      );
      toast(newStatus === "rejected" ? "Order rejected" : `Order marked ${newStatus} ✅`);
    } catch (err) {
      console.error("ORDER STATUS ERROR:", err);
      toast(err?.message || "Unable to update order", "err");
    } finally {
      setUpdatingOrder("");
    }
  };

  /* Live device GPS — the farmer's real "here". Resolves
     {latitude, longitude} or null when denied/unavailable.  */

  const getLiveLocation = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            latitude: Number(
              pos.coords.latitude.toFixed(6)
            ),
            longitude: Number(
              pos.coords.longitude.toFixed(6)
            ),
          }),
        () => resolve(null),
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 30000,
        }
      );
    });

  const acceptIncomingOrder = async (order) => {
    let extra = {};
    try {
      const farmerSnap = await getDoc(doc(db, "users", currentUser.uid));
      if (farmerSnap.exists()) {
        const d = farmerSnap.data();
        extra = {
          farmerName: d.name || profile.name || "",
          farmerPhone: d.phone || "",
          farmerLocation: d.location || null,
        };
      }
    } catch { /* optional enrichment */ }

    /* REAL-distance pickup point: the SAVED FARM LOCATION is the
       pickup anchor — it is what the consumer was quoted at
       checkout (farm → consumer) and where the farm actually is.
       The profile is NOT overwritten with live coords.

       Live device GPS is only a fallback when the farmer has
       never saved a farm location. Using live GPS as the primary
       pickup used to silently re-point every accepted order to
       wherever the farmer happened to be (home, market...) — the
       delivery partner then measured a huge farmer→consumer
       distance and got "out of 7 km range" even though the farm
       and the consumer were close.                                      */
    const live = await getLiveLocation();
    if (live) {
      // Reference only — never used for the trip distance.
      extra.farmerLiveLocation = live;
    }

    const farmAnchor =
      extra.farmerLocation &&
      Number.isFinite(Number(extra.farmerLocation.latitude)) &&
      Number(extra.farmerLocation.latitude) !== 0 &&
      Number.isFinite(Number(extra.farmerLocation.longitude)) &&
      Number(extra.farmerLocation.longitude) !== 0
        ? extra.farmerLocation
        : null;

    if (!farmAnchor) {
      extra.farmerLocation = live;
    }

    /* THE 7 KM DELIVERY RULE NEEDS A REAL PICKUP POINT.
       Without valid coordinates the trip distance can't be
       measured — the delivery range check and the distance-
       based charge would silently break. Block the accept and
       tell the farmer exactly how to fix it.                    */
    const pickup = extra.farmerLocation;
    const validPickup =
      pickup &&
      Number.isFinite(Number(pickup.latitude)) &&
      Number(pickup.latitude) !== 0 &&
      Number.isFinite(Number(pickup.longitude)) &&
      Number(pickup.longitude) !== 0;

    if (!validPickup) {
      toast(
        "📍 No pickup point! Turn on GPS and accept again, or save your farm Lat/Lng in Profile → Location. Delivery distance and the 7 km rule need it.",
        "err"
      );
      return;
    }

    await doUpdateStatus(order.id, "accepted", extra);
  };

  /* Hide a finished order from THIS dashboard only — the
     Firestore document stays untouched for the consumer and
     the delivery partner. */
  const removeOrderHistory = (orderId) => {
    const ok = window.confirm(
      "Clear this order from your history?\n\nIt only disappears from your dashboard — the record stays in Firebase for the consumer and the delivery partner."
    );
    if (!ok) return;

    persistHiddenHistory([...new Set([...hiddenHistoryIds, orderId])]);
    toast("Order cleared from your history (still saved in Firebase) 🗑️");
  };

  /* Bulk: hide every finished order (delivered / rejected). */
  const clearFarmerHistory = () => {
    const finished = visibleIncomingOrders.filter(
      (o) => o.status === "delivered" || o.status === "rejected"
    );
    if (finished.length === 0) {
      toast("No finished orders to clear", "err");
      return;
    }

    const ok = window.confirm(
      `Clear ${finished.length} finished order${finished.length === 1 ? "" : "s"} (delivered / rejected) from your history?\n\nThey only disappear from this dashboard — Firebase records stay.`
    );
    if (!ok) return;

    persistHiddenHistory([
      ...new Set([...hiddenHistoryIds, ...finished.map((o) => o.id)]),
    ]);
    toast(`${finished.length} order(s) cleared from your history 🗑️`);
  };

  /* =========================================================
     LOCATION SAVE
  ========================================================= */

  const saveLocation = async () => {
    if (!locCity.trim() || !locState.trim()) {
      toast("City and state are required", "err");
      return;
    }

    /* The saved farm location is the pickup anchor for the
       7 km delivery rule — it must be REAL coordinates
       (capture with 📍 or type them), never zeros.            */
    const lat = Number(locLat);
    const lng = Number(locLng);
    if (
      !Number.isFinite(lat) || lat === 0 || lat < -90 || lat > 90 ||
      !Number.isFinite(lng) || lng === 0 || lng < -180 || lng > 180
    ) {
      toast("Latitude & longitude required (use 📍 capture) — delivery distance is measured from here", "err");
      return;
    }

    setSavingLocation(true);
    try {
      await setDoc(
        doc(db, "users", currentUser.uid),
        {
          address: locAddress.trim(),
          city: locCity.trim(),
          state: locState.trim(),
          pincode: locPincode.trim(),
          location: { latitude: lat, longitude: lng },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setProfile((p) => ({ ...p, address: locAddress, city: locCity, state: locState, pincode: locPincode }));
      toast("Location saved 📍");
    } catch (err) {
      toast(err?.message || "Unable to save location", "err");
    } finally {
      setSavingLocation(false);
    }
  };

  const getLocation = () => {
    if (!navigator.geolocation) { toast("Geolocation not supported", "err"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        /* The farm location is the 7 km delivery anchor — never
           accept a city-level browser guess (±km accuracy).      */
        const acc = Number(pos.coords.accuracy);
        if (Number.isFinite(acc) && acc > 1000) {
          toast(
            `⚠️ Browser location unreliable (±${(acc / 1000).toFixed(1)} km) — NOT used. Drag the 📍 map pin below or type Lat/Lng.`,
            "err"
          );
          return;
        }
        setLocLat(String(pos.coords.latitude.toFixed(6)));
        setLocLng(String(pos.coords.longitude.toFixed(6)));
        toast("Location captured 📍");
      },
      () => toast("Could not get your location", "err"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  /* =========================================================
     LOGOUT / SEARCH / CAROUSEL
  ========================================================= */

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/login", { replace: true });
    } catch {
      toast("Logout failed. Try again.", "err");
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setBrowseQuery(searchQuery);
    go("browse");
  };

  const carRef = useRef(null);
  const scrollCarousel = (dir) => {
    if (carRef.current) {
      carRef.current.scrollBy({ left: dir * 480, behavior: "smooth" });
    }
  };

  /* ---------- SHARED RENDER HELPERS ---------- */

  const statusChipOf = (status) => {
    switch (status) {
      case "pending": return { label: "Pending", cls: "amber" };
      case "accepted": return { label: "Shipped", cls: "blue" };
      case "delivered": return { label: "Delivered", cls: "green" };
      case "rejected": return { label: "Rejected", cls: "red" };
      case "processing": return { label: "Processing", cls: "amber" };
      default: return { label: status || "—", cls: "gray" };
    }
  };

  const fmtDate = (sec) => {
    if (!sec) return "—";
    const d = new Date(sec * 1000);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const pctDelta = (cur, prev) => {
    if (!prev) return cur ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 100);
  };

  const firstName = (profile.name || currentUser?.email?.split("@")[0] || "Farmer").split(" ")[0];

  /* =========================================================
     SIDEBAR
  ========================================================= */

  const renderSidebar = () => (
    <aside className={`fd-sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="fd-brand">
        <div className="fd-brand-mark">🌿</div>
        <div>
          <div className="fd-brand-name">E-FARM</div>
          <div className="fd-brand-tag">Smart Farming. Better Future.</div>
        </div>
      </div>

      <nav className="fd-nav">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="fd-nav-group">{g.group}</div>
            {g.items.map((item) => (
              <button
                key={item.id}
                className={`fd-nav-item ${activeSection === item.id ? "active" : ""}`}
                onClick={() => go(item.id)}
              >
                <Ic name={item.icon} />
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="fd-help" onClick={() => go("ai")} role="button">
        <div>
          <div className="fd-help-title">Need Help?</div>
          <div className="fd-help-sub">Ask our AI assistant</div>
        </div>
        <span className="fd-help-btn">Chat Now</span>
      </div>
    </aside>
  );

  /* =========================================================
     TOPBAR
  ========================================================= */

  const renderTopbar = () => (
    <header className="fd-topbar">
      <button className="fd-burger" onClick={() => setSidebarOpen((s) => !s)} aria-label="Menu">
        <Ic name="menu" size={22} />
      </button>

      <form className="fd-search" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search items, categories, products..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button type="submit">Search</button>
      </form>

      <div className="fd-topbar-right">
        <button className="fd-icon-btn" onClick={() => { setCartOpen(true); setNotifOpen(false); setProfileOpen(false); }}>
          <Ic name="cart" size={21} />
          {cartCount > 0 && <span className="fd-badge">{cartCount}</span>}
        </button>

        <button className="fd-icon-btn" onClick={() => { setNotifOpen((n) => !n); setProfileOpen(false); }}>
          <Ic name="bell" size={21} />
          {unreadNotifs.length > 0 && <span className="fd-badge">{unreadNotifs.length}</span>}
        </button>

        <button className="fd-profile-btn" onClick={() => { setProfileOpen((p) => !p); setNotifOpen(false); }}>
          <span className="fd-avatar">{(profile.name || "F")[0].toUpperCase()}</span>
          <span>
            <span className="fd-profile-name">{profile.name || "Farmer"}</span><br />
            <span className="fd-profile-role">Farmer</span>
          </span>
          <Ic name="chevD" size={15} />
        </button>
      </div>

      {notifOpen && (
        <div className="fd-drop">
          <div className="fd-drop-head">Notifications</div>
          {notifications.length === 0 && (
            <div className="fd-notif-empty">🎉 All caught up! No new notifications.</div>
          )}
          {notifications.map((n) => (
            <div key={n.id} className="fd-notif-item" style={{ cursor: "pointer" }} onClick={() => go(n.section)}>
              <span className="fd-notif-icon"><Ic name={n.icon} size={16} /></span>
              <span>
                <span className="fd-notif-title">{n.title}</span>
                <span className="fd-notif-text" style={{ display: "block" }}>{n.text}</span>
              </span>
            </div>
          ))}
          <button className="fd-btn ghost" style={{ width: "100%", marginTop: 6 }} onClick={markNotifsRead}>
            Mark all as read
          </button>
        </div>
      )}

      {profileOpen && (
        <div className="fd-drop fd-profile-menu">
          <div className="fd-profile-head">
            <span className="fd-avatar">{(profile.name || "F")[0].toUpperCase()}</span>
            <span>
              <span className="fd-notif-title" style={{ display: "block" }}>{profile.name || "Farmer"}</span>
              <span className="fd-notif-text">{profile.email || currentUser?.email}</span>
            </span>
          </div>
          <button onClick={() => go("myproducts")}><Ic name="box" size={16} /> My Products</button>
          <button onClick={() => go("myorders")}><Ic name="receipt" size={16} /> My Orders</button>
          <button onClick={() => go("location")}><Ic name="settings" size={16} /> Location Settings</button>
          <button className="danger" onClick={handleLogout}><Ic name="logout" size={16} /> Logout</button>
        </div>
      )}
    </header>
  );

  /* =========================================================
     PRODUCT CARD (shared)
  ========================================================= */

  const renderProductCard = (p) => {
    if (!p) return null;
    const icon = categoryIconOf(p.category);
    const isSaved = saved.includes(p.id);
    return (
      <div className="fd-pcard" key={p.id}>
        <div className="fd-pcard-art">
          {p.imageUrl ? <img src={p.imageUrl} alt={p.name} /> : <span>{icon}</span>}
          <button
            className={`fd-pcard-save ${isSaved ? "on" : ""}`}
            onClick={() => toggleSave(p.id)}
            title="Save item"
          >
            {isSaved ? "❤️" : "🤍"}
          </button>
        </div>
        <div className="fd-pcard-brand">{p.category || "Agri Input"}</div>
        <div className="fd-pcard-name">{p.name}</div>
        <div className="fd-pcard-price">
          {rupee(p.price)}{unitSuffixOf(p.unit)}
          {Number(p.quantity) > 0 && <small> • {p.quantity}{qtyUnitOf(p.unit)} in stock</small>}
        </div>
        <div className="fd-pcard-foot">
          <Stars value={ratingOf(p.id)} />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              className="fd-btn ghost"
              style={{ padding: "7px 9px" }}
              title="Add to comparison"
              onClick={() => toggleCompare(p.id)}
            >
              ⇄
            </button>
            <button className="fd-add-btn" onClick={() => addToCart(p)}>Add to Cart</button>
          </div>
        </div>
      </div>
    );
  };

  /* =========================================================
     CART DRAWER
  ========================================================= */

  const renderCart = () => (
    <div className="fd-drawer">
      <div className="fd-drawer-head">
        <b>Your Cart ({cartCount})</b>
        <button className="fd-icon-btn" onClick={() => setCartOpen(false)}><Ic name="x" size={18} /></button>
      </div>

      <div className="fd-drawer-body">
        {cart.length === 0 && (
          <div className="fd-empty">
            <div className="fd-empty-art">🛒</div>
            Your cart is empty.<br />Browse products to add items.
          </div>
        )}

        {cart.map((i) => (
          <div className="fd-cart-item" key={i.key}>
            <div className="fd-mini-art">{i.img ? <img src={i.img} alt={i.name} /> : <span>{i.art}</span>}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="fd-list-title">{i.name}</div>
              <div className="fd-list-sub">{rupee(i.price)} each</div>
              <div className="fd-qty">
                <button onClick={() => changeQty(i.key, -1)}><Ic name="minus" size={13} /></button>
                <span>{i.qty}</span>
                <button onClick={() => changeQty(i.key, 1)}><Ic name="plus" size={13} /></button>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <b style={{ fontSize: 14 }}>{rupee(i.price * i.qty)}</b>
              <div>
                <button className="fd-btn danger" style={{ padding: "6px 10px", marginTop: 8 }} onClick={() => removeFromCart(i.key)}>
                  <Ic name="trash" size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {cart.length > 0 && (
          <div className="fd-form" style={{ marginTop: 16 }}>
            <div className="full"><b style={{ fontSize: 13, color: "#12291c" }}>Delivery Details</b></div>
            <div>
              <label>Full Name</label>
              <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Your name" />
            </div>
            <div>
              <label>Phone</label>
              <input value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} placeholder="10-digit phone" />
            </div>
            <div className="full">
              <label>Address</label>
              <input value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} placeholder="Village / street" />
            </div>
            <div>
              <label>City</label>
              <input value={buyerCity} onChange={(e) => setBuyerCity(e.target.value)} placeholder="City" />
            </div>
            <div>
              <label>Pincode</label>
              <input value={buyerPincode} onChange={(e) => setBuyerPincode(e.target.value)} placeholder="Pincode" />
            </div>
          </div>
        )}
      </div>

      {cart.length > 0 && (
        <div className="fd-drawer-foot">
          <div className="fd-total-row"><span>Subtotal ({cartCount} items)</span><b>{rupee(cartTotal)}</b></div>
          <div className="fd-total-row"><span>Delivery fee</span><b>FREE</b></div>
          {cartTotal < MIN_ORDER_VALUE && (
            <div className="fd-min-order-note">⚠️ Minimum order {rupee(MIN_ORDER_VALUE)} — add {rupee(MIN_ORDER_VALUE - cartTotal)} more</div>
          )}
          <div className="fd-total-row grand"><span>Grand Total</span><span>{rupee(cartTotal)}</span></div>
          <button className="fd-place-btn" onClick={placeInputOrder} disabled={placingOrder || cartTotal < MIN_ORDER_VALUE}>
            {placingOrder ? "PLACING ORDER..." : cartTotal < MIN_ORDER_VALUE ? `MINIMUM ORDER ${rupee(MIN_ORDER_VALUE)}` : `PLACE ORDER • ${rupee(cartTotal)}`}
          </button>
        </div>
      )}
    </div>
  );

  /* =========================================================
     DASHBOARD OVERVIEW
  ========================================================= */

  const renderDashboard = () => {
    const prevStart = dayStart(rangeDays * 2);
    const prevOrders = incomingOrders.filter((o) => {
      const s = o.createdAt?.seconds || 0;
      return s < startSec && s >= prevStart;
    }).length;
    const prevSpend = allInputOrders
      .filter((o) => {
        const s = o.createdAt?.seconds || o.placedAtSec || 0;
        return s < startSec && s >= prevStart;
      })
      .reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

    const dOrders = pctDelta(ordersInRange.length, prevOrders);
    const dSpend = pctDelta(spendInRange, prevSpend);
    const cond = WEATHER_CODES[weather.code] || ["Partly cloudy", "⛅"];

    return (
      <div>
        <div className="fd-dash-grid">
          <div className="fd-dash-col">
            <div className="fd-welcome" style={{ marginBottom: 0 }}>
              <div>
                <h1>Welcome back, <span>{firstName}</span> 👋</h1>
                <div className="fd-welcome-sub">Here's what's happening with your farm today.</div>
              </div>
              <select className="fd-season-select" value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)}>
                <option>This Month</option>
                <option>This Season</option>
                <option>All Time</option>
              </select>
            </div>

            <div className="fd-stats">
              <div className="fd-stat">
                <div className="fd-stat-top">
                  <span className="fd-stat-icon"><Ic name="cart" size={20} /></span>
                  <div>
                    <div className="fd-stat-value">{ordersInRange.length}</div>
                    <div className="fd-stat-label">Orders Placed</div>
                  </div>
                </div>
                <div className="fd-stat-foot">
                  <span className={dOrders >= 0 ? "fd-up" : "fd-down"}>{dOrders >= 0 ? "↑" : "↓"} {Math.abs(dOrders)}%</span>
                  from last month
                </div>
              </div>

              <div className="fd-stat">
                <div className="fd-stat-top">
                  <span className="fd-stat-icon"><Ic name="heart" size={20} /></span>
                  <div>
                    <div className="fd-stat-value">{saved.length}</div>
                    <div className="fd-stat-label">Items Saved</div>
                  </div>
                </div>
                <div className="fd-stat-foot"><span className="fd-up">↑ 15%</span> from last month</div>
              </div>

              <div className="fd-stat">
                <div className="fd-stat-top">
                  <span className="fd-stat-icon fd-stat-icon-sun"><Ic name="wallet" size={20} /></span>
                  <div>
                    <div className="fd-stat-value">{rupee(spendInRange)}</div>
                    <div className="fd-stat-label">Total Spent</div>
                  </div>
                </div>
                <div className="fd-stat-foot">
                  <span className={dSpend <= 0 ? "fd-down" : "fd-up"}>{dSpend >= 0 ? "↑" : "↓"} {Math.abs(dSpend)}%</span>
                  from last month
                </div>
              </div>

              <div className="fd-stat">
                <div className="fd-stat-top">
                  <span className="fd-stat-icon"><Ic name="truck" size={20} /></span>
                  <div>
                    <div className="fd-stat-value">{activeTracking}</div>
                    <div className="fd-stat-label">Active Tracking</div>
                  </div>
                </div>
                <div className="fd-stat-foot">On the way</div>
              </div>
            </div>

            <div className="fd-card">
              <div className="fd-card-head">
                <div className="fd-card-title">Categories</div>
                <button className="fd-link-btn" onClick={() => go("categories")}>View All</button>
              </div>
              <div className="fd-cats">
                                {CATEGORIES.map((c) => (
                  <button className="fd-cat" key={c.id} onClick={() => goBrowse(c.id)}>
                    <span className="fd-cat-icon">{c.icon}</span>
                    <span className="fd-cat-name">{c.id}</span>
                    <span className="fd-cat-desc">{c.desc}</span>
                  </button>
                ))}
            </div>
            </div>

            <div className="fd-card">
              <div className="fd-card-head">
                <div className="fd-card-title">Recommended Products</div>
                <button className="fd-link-btn" onClick={() => goBrowse()}>View All</button>
              </div>
              <div className="fd-prod-row">
                <button className="fd-car-arrow left" onClick={() => scrollCarousel(-1)}><Ic name="chevL" /></button>
                <div className="fd-carousel" ref={carRef}>
                  {recommended.length === 0 && (
                    <div className="fd-empty" style={{ width: "100%" }}>
                      <div className="fd-empty-art">🌾</div>
                      No products in the marketplace yet. Add yours from My Products.
                    </div>
                  )}
                  {recommended.map(renderProductCard)}
                </div>
                <button className="fd-car-arrow right" onClick={() => scrollCarousel(1)}><Ic name="chevR" /></button>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="fd-dash-side">
            <div className="fd-weather">
              <div className="fd-weather-head">
                <span>Weather Update</span>
                <Ic name="cloud" size={20} />
              </div>
              <div className="fd-weather-loc">
                <Ic name="pin" size={13} />
                {weather.loading ? "Loading location..." : weather.city}
              </div>
              <div className="fd-weather-art">{cond[1]}</div>
              <div className="fd-weather-temp">
                {weather.loading ? "—" : weather.temp}
                <small>°C</small>
              </div>
              <div className="fd-weather-cond">
                {weather.loading ? "Loading..." : cond[0]}
              </div>
              <div className="fd-weather-meta">
                <div><Ic name="drop" size={16} /><div><span>Humidity</span>{weather.loading ? "—" : `${weather.humidity}%`}</div></div>
                <div><Ic name="wind" size={16} /><div><span>Wind</span>{weather.loading ? "—" : `${weather.wind} km/h`}</div></div>
                <div><Ic name="cloud" size={16} /><div><span>Rain Chance</span>{weather.loading ? "—" : `${weather.rain}%`}</div></div>
              </div>
              <button className="fd-forecast-btn" onClick={() => go("weather")}>View Full Forecast</button>
            </div>

            <div className="fd-card">
              <div className="fd-card-head">
                <div className="fd-card-title">Market Price Overview</div>
                <button className="fd-link-btn" onClick={() => go("prices")}>View All</button>
              </div>
              <table className="fd-table">
                <thead>
                  <tr>
                    <th>Commodity</th>
                    <th>Market Price</th>
                    <th>Trend</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {MARKET_PRICES.slice(0, 5).map((m) => {
                    const last = m.history[m.history.length - 1];
                    const first = m.history[0];
                    const chg = ((last - first) / first) * 100;
                    return (
                      <tr key={m.name}>
                        <td className="t-name">{m.name}</td>
                        <td className="fd-price-cell">{rupee(last)}</td>
                        <td><Sparkline data={m.history} up={chg >= 0} /></td>
                        <td className={chg >= 0 ? "t-up" : "t-down"}>
                          {chg >= 0 ? "↑" : "↓"} {Math.abs(chg).toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="fd-card">
              <div className="fd-card-head">
                <div className="fd-card-title">Quick Actions</div>
              </div>
              <div className="fd-quick">
                <button className="fd-quick-btn" onClick={() => go("compare")}>
                  <span className="fd-quick-icon"><Ic name="scale" size={20} /></span>
                  <span>Compare Products</span>
                </button>
                <button className="fd-quick-btn" onClick={() => go("track")}>
                  <span className="fd-quick-icon"><Ic name="truck" size={20} /></span>
                  <span>Track Order</span>
                </button>
                <button className="fd-quick-btn" onClick={() => go("schemes")}>
                  <span className="fd-quick-icon"><Ic name="wallet" size={20} /></span>
                  <span>Request Quote</span>
                </button>
                <button className="fd-quick-btn" onClick={() => go("sources")}>
                  <span className="fd-quick-icon"><Ic name="pin" size={20} /></span>
                  <span>Find Local Vendors</span>
                </button>
                <button className="fd-quick-btn" onClick={() => go("ai")}>
                  <span className="fd-quick-icon"><Ic name="bot" size={20} /></span>
                  <span>AI Crop Assistant</span>
                </button>
              </div>
            </div>

            <div className="fd-card">
              <div className="fd-card-head">
                <div className="fd-card-title">Recent Orders</div>
                <button className="fd-link-btn" onClick={() => go("track")}>Track All</button>
              </div>
              {incomingOrders.length === 0 && (
                <div className="fd-notif-empty">No incoming orders yet. Your produce orders will appear here.</div>
              )}
              {incomingOrders.slice(0, 3).map((o) => {
                const chip = statusChipOf(o.status);
                return (
                  <div className="fd-order-row" key={o.id}>
                    <div className="fd-order-art">🌾</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="fd-order-name">{o.productName || "Produce order"}</div>
                      <div className="fd-order-sub">Order ID: #{String(o.id).slice(-6).toUpperCase()}</div>
                    </div>
                    <span className={`fd-chip ${chip.cls}`}>{chip.label}</span>
                    <span className="fd-order-date">{fmtDate(o.createdAt?.seconds)}</span>
                  </div>
                );
              })}
              <button className="fd-track-all" onClick={() => go("track")}>
                Track All Orders <Ic name="arrowR" size={15} />
              </button>
            </div>
          </div>
        </div>

        <div className="fd-bottom-grid" style={{ marginTop: 16 }}>
          <div className="fd-card">
            <div className="fd-card-head">
              <div className="fd-card-title">Seasonal Calendar</div>
              <button className="fd-link-btn" onClick={() => go("calendar")}>View Full Calendar</button>
            </div>
            <div className="fd-months">
              {MONTHS.map((m) => (
                <button key={m} className={`fd-month-tab ${calMonth === m ? "active" : ""}`} onClick={() => setCalMonth(m)}>
                  {m}
                </button>
              ))}
            </div>
            {(SEASONAL_TASKS[calMonth] || []).map((t) => (
              <div className="fd-task" key={t[1]}>
                <div className="fd-task-icon">{t[0]}</div>
                <div>
                  <div className="fd-task-title">{t[1]}</div>
                  <div className="fd-task-desc">{t[2]}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="fd-card">
            <div className="fd-card-head">
              <div className="fd-card-title">Top Local Vendors</div>
              <button className="fd-link-btn" onClick={() => go("sources")}>View All</button>
            </div>
            {LOCAL_VENDORS.slice(0, 3).map((v) => (
              <div className="fd-vendor" key={v.name}>
                <div className="fd-vendor-avatar">🏪</div>
                <div style={{ minWidth: 0 }}>
                  <div className="fd-vendor-name">{v.name}</div>
                  <div className="fd-vendor-city">{v.city}</div>
                </div>
                <span className="fd-rate">★ {v.rating}</span>
                <button className="fd-view-shop" onClick={() => go("sources")}>View Shop</button>
              </div>
            ))}
          </div>

          <div className="fd-card">
            <div className="fd-card-head">
              <div className="fd-card-title">Top Global Sources</div>
              <button className="fd-link-btn" onClick={() => go("global")}>View All</button>
            </div>
            {GLOBAL_SOURCES.slice(0, 3).map((v) => (
              <div className="fd-vendor" key={v.name}>
                <div className="fd-vendor-avatar">🌐</div>
                <div style={{ minWidth: 0 }}>
                  <div className="fd-vendor-name">{v.name}</div>
                  <div className="fd-vendor-city">{v.country}</div>
                </div>
                <span className="fd-rate">★ {v.rating}</span>
                <button className="fd-view-shop" onClick={() => go("global")}>View Shop</button>
              </div>
            ))}
          </div>

          <div className="fd-card">
            <div className="fd-card-head">
              <div className="fd-card-title">AI Crop Assistant</div>
              <button className="fd-link-btn" onClick={() => go("ai")}>Open</button>
            </div>
            <div className="fd-ai-hint">
              Ask me anything about crops, diseases, fertilizers, and more.
            </div>
            <div className="fd-ai-mini">
              <input
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                placeholder="Type your question..."
                onKeyDown={(e) => { if (e.key === "Enter") { askAI(); go("ai"); } }}
              />
              <button className="fd-ai-send" onClick={() => { askAI(); go("ai"); }}>
                <Ic name="send" size={17} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  /* =========================================================
     BROWSE PRODUCTS
  ========================================================= */

  const renderBrowse = () => (
    <div>
      <h2 className="fd-page-title">Browse Products</h2>
      <p className="fd-page-sub">Shop seeds, fertilizers, machinery and more from the E-Farm marketplace.</p>

      <div className="fd-filters">
        <button className={`fd-chip-filter ${browseCategory === "all" ? "active" : ""}`} onClick={() => setBrowseCategory("all")}>
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={`fd-chip-filter ${browseCategory === c.id ? "active" : ""}`}
            onClick={() => setBrowseCategory(c.id)}
          >
            {c.icon} {c.id}
          </button>
        ))}
        <select className="fd-select" value={browseSort} onChange={(e) => setBrowseSort(e.target.value)}>
          <option value="new">Newest first</option>
          <option value="low">Price: Low to High</option>
          <option value="high">Price: High to Low</option>
        </select>
      </div>

      {(browseQuery || browseCategory !== "all") && (
        <div className="fd-count-note">
          {filteredProducts.length} result(s)
          {browseQuery ? ` for "${browseQuery}"` : ""} —{" "}
          <button className="fd-link-btn" onClick={() => { setBrowseCategory("all"); setBrowseQuery(""); setSearchQuery(""); }}>
            clear filters
          </button>
        </div>
      )}

      <div className="fd-prod-grid">
        {filteredProducts.map(renderProductCard)}
      </div>
      {filteredProducts.length === 0 && (
        <div className="fd-empty">
          <div className="fd-empty-art">🔍</div>
          No products found. Try a different search or category.
        </div>
      )}
    </div>
  );

  /* =========================================================
     CATEGORIES
  ========================================================= */

  const renderCategories = () => (
    <div>
      <h2 className="fd-page-title">Categories</h2>
      <p className="fd-page-sub">Shop by category — live counts from the marketplace.</p>
      <div className="fd-prod-grid">
        {CATEGORIES.map((c) => {
          const count = products.filter((p) => p && (p.category || "") === c.id).length;
          return (
            <button className="fd-cat" key={c.id} style={{ padding: "22px 10px" }} onClick={() => goBrowse(c.id)}>
              <span className="fd-cat-icon" style={{ width: 64, height: 64, fontSize: 30 }}>{c.icon}</span>
              <span className="fd-cat-name" style={{ fontSize: 14 }}>{c.id}</span>
              <span className="fd-cat-desc">{c.desc}</span>
              <span className="fd-tag">{count} products</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  /* =========================================================
     COMPARE
  ========================================================= */

  const renderCompare = () => (
    <div>
      <h2 className="fd-page-title">Compare Products</h2>
      <p className="fd-page-sub">Compare up to 3 products side by side. Click ⇄ on any product to add it.</p>

      {compareProducts.length === 0 ? (
        <div className="fd-empty">
          <div className="fd-empty-art">⇄</div>
          Nothing to compare yet — add products from Browse Products.
          <div style={{ marginTop: 14 }}>
            <button className="fd-btn primary" onClick={() => goBrowse()}>Browse Products</button>
          </div>
        </div>
      ) : (
        <div className="fd-compare-grid">
          {compareProducts.map((p) => {
            if (!p) return null;
            return (
            <div className="fd-card" key={p.id}>
              <div className="fd-pcard-art" style={{ height: 110 }}>
                {p.imageUrl ? <img src={p.imageUrl} alt={p.name} /> : <span>{categoryIconOf(p.category)}</span>}
              </div>
              <div className="fd-list-title" style={{ marginTop: 10 }}>{p.name}</div>
              <div className="fd-cmp-row"><span>Price</span><b>{rupee(p.price)}{unitSuffixOf(p.unit)}</b></div>
              <div className="fd-cmp-row"><span>Stock</span><b>{p.quantity || 0}{qtyUnitOf(p.unit)}</b></div>
              <div className="fd-cmp-row"><span>Category</span><b>{p.category || "—"}</b></div>
              <div className="fd-cmp-row"><span>Rating</span><b>{ratingOf(p.id).toFixed(1)} ★</b></div>
              <div className="fd-actions" style={{ marginTop: 12 }}>
                <button className="fd-btn primary" onClick={() => addToCart(p)}>Add to Cart</button>
                <button className="fd-btn danger" onClick={() => toggleCompare(p.id)}>Remove</button>
              </div>
            </div>
          );
          })}
        </div>
      )}
    </div>
  );

  /* =========================================================
     MARKET PRICES
  ========================================================= */

  const renderPrices = () => (
    <div>
      <h2 className="fd-page-title">Market Prices</h2>
      <p className="fd-page-sub">Reference mandi prices per quintal with 6-month trend.</p>
      <div className="fd-card">
        <table className="fd-table">
          <thead>
            <tr>
              <th>Commodity</th>
              <th>Market Price</th>
              <th>Trend</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {MARKET_PRICES.map((m) => {
              const last = m.history[m.history.length - 1];
              const first = m.history[0];
              const chg = ((last - first) / first) * 100;
              return (
                <tr key={m.name}>
                  <td className="t-name">{m.name}</td>
                  <td className="fd-price-cell">{rupee(last)}</td>
                  <td><Sparkline data={m.history} up={chg >= 0} /></td>
                  <td className={chg >= 0 ? "t-up" : "t-down"}>
                    {chg >= 0 ? "↑" : "↓"} {Math.abs(chg).toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  /* =========================================================
     PRICE TRENDS
  ========================================================= */

  const renderTrends = () => {
    const m = MARKET_PRICES.find((x) => x.name === trendCommodity) || MARKET_PRICES[0];
    const w = 560, h = 220, pad = 26;
    const min = Math.min(...m.history), max = Math.max(...m.history);
    const range = max - min || 1;
    const pts = m.history.map((v, i) => [
      pad + (i * (w - pad * 2)) / (m.history.length - 1),
      h - pad - ((v - min) / range) * (h - pad * 2),
    ]);
    const line = pts.map((p) => p.join(",")).join(" ");
    const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
    const last = m.history[m.history.length - 1];
    const first = m.history[0];
    const chg = ((last - first) / first) * 100;
    const now = new Date().getMonth();
    const labels = [5, 4, 3, 2, 1, 0].map((back) => MONTHS[(now - back + 12) % 12]);

    return (
      <div>
        <h2 className="fd-page-title">Price Trends</h2>
        <p className="fd-page-sub">6-month price movement per commodity.</p>

        <div className="fd-commodity-tabs">
          {MARKET_PRICES.map((c) => (
            <button
              key={c.name}
              className={`fd-chip-filter ${trendCommodity === c.name ? "active" : ""}`}
              onClick={() => setTrendCommodity(c.name)}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="fd-card">
          <div className="fd-card-head">
            <div className="fd-card-title">{m.name} — {rupee(last)} / quintal</div>
            <span className={`fd-chip ${chg >= 0 ? "green" : "red"}`}>
              {chg >= 0 ? "↑" : "↓"} {Math.abs(chg).toFixed(1)}% (6 mo)
            </span>
          </div>
          <div className="fd-chart-wrap">
            <svg className="fd-chart-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
              <polygon points={area} fill="rgba(21,128,61,0.12)" />
              <polyline points={line} fill="none" stroke="#15803d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {pts.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="#15803d" />
              ))}
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#7c8b7e", padding: "4px 8px 0" }}>
              {labels.map((l) => <span key={l}>{l}</span>)}
            </div>
          </div>
          <div className="fd-trend-legend">
            <span><i></i>{m.name} price history</span>
            <span>High: {rupee(max)}</span>
            <span>Low: {rupee(min)}</span>
          </div>
        </div>
      </div>
    );
  };

  /* =========================================================
     SEASONAL INSIGHTS
  ========================================================= */

  const renderSeasonal = () => {
    const seasons = [
      { name: "Kharif", months: "Jun – Oct", icon: "🌧️", crops: "Rice, maize, cotton, soybean", tip: "Sow with monsoon onset; manage drainage and pest pressure." },
      { name: "Rabi", months: "Nov – Mar", icon: "❄️", crops: "Wheat, gram, mustard", tip: "Irrigation-led season — protect crops from frost in Dec-Jan." },
      { name: "Zaid", months: "Apr – Jun", icon: "☀️", crops: "Moong, cucumber, fodder", tip: "Short window — plan frequent light irrigations." },
    ];
    return (
      <div>
        <h2 className="fd-page-title">Seasonal Insights</h2>
        <p className="fd-page-sub">Plan your farm year around Indian cropping seasons.</p>
        <div className="fd-compare-grid">
          {seasons.map((s) => (
            <div className="fd-card" key={s.name}>
              <div style={{ fontSize: 34 }}>{s.icon}</div>
              <div className="fd-list-title" style={{ fontSize: 16, marginTop: 6 }}>
                {s.name} <span className="fd-tag">{s.months}</span>
              </div>
              <div className="fd-list-sub" style={{ margin: "8px 0" }}><b>Main crops:</b> {s.crops}</div>
              <div className="fd-list-sub">{s.tip}</div>
            </div>
          ))}
        </div>

        <div className="fd-card" style={{ marginTop: 16 }}>
          <div className="fd-card-head">
            <div className="fd-card-title">This Month — {calMonth}</div>
            <button className="fd-link-btn" onClick={() => go("calendar")}>Full Calendar</button>
          </div>
          {(SEASONAL_TASKS[calMonth] || []).map((t) => (
            <div className="fd-task" key={t[1]}>
              <div className="fd-task-icon">{t[0]}</div>
              <div>
                <div className="fd-task-title">{t[1]}</div>
                <div className="fd-task-desc">{t[2]}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  /* =========================================================
     LOCAL SOURCES
  ========================================================= */

  const renderSources = () => (
    <div>
      <h2 className="fd-page-title">Local Sources</h2>
      <p className="fd-page-sub">Verified agri-input vendors near you in Madhya Pradesh.</p>
      <div className="fd-source-grid">
        {LOCAL_VENDORS.map((v) => (
          <div className="fd-source" key={v.name}>
            <div className="fd-source-icon">🏪</div>
            <div style={{ minWidth: 0 }}>
              <div className="fd-source-name">{v.name}</div>
              <div className="fd-source-type">{v.type}</div>
              <div className="fd-source-city">{v.city} • ★ {v.rating}</div>
              <div className="fd-source-actions">
                <a className="fd-btn primary" style={{ textDecoration: "none" }} href={`tel:+91${v.phone}`}>
                  <Ic name="phone" size={14} /> Call
                </a>
                <a
                  className="fd-btn ghost"
                  style={{ textDecoration: "none" }}
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.name + " " + v.city)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Ic name="pin" size={14} /> Directions
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  /* =========================================================
     GLOBAL SOURCES
  ========================================================= */

  const renderGlobal = () => (
    <div>
      <h2 className="fd-page-title">Global Sources</h2>
      <p className="fd-page-sub">
        International suppliers for bulk and specialty agri needs. Tap Email to request a quote,
        open their Website, or Call them directly to arrange shipping.
      </p>
      <div className="fd-source-grid">
        {GLOBAL_SOURCES.map((v) => (
          <div className="fd-source" key={v.name}>
            <div className="fd-source-icon">🌐</div>
            <div style={{ minWidth: 0 }}>
              <div className="fd-source-name">{v.name}</div>
              <div className="fd-source-type">{v.type}</div>
              <div className="fd-source-city">{v.country} • ★ {v.rating}</div>
              {v.products && <div className="fd-source-desc">{v.products}</div>}
              <div className="fd-source-actions">
                {v.email && (
                  <a
                    className="fd-btn primary"
                    style={{ textDecoration: "none" }}
                    href={`mailto:${encodeURIComponent(v.email)}?subject=${encodeURIComponent(
                      `Enquiry for ${v.name} agri-inputs`
                    )}&body=${encodeURIComponent(
                      `Hello ${v.name} team,\n\nI am an E-Farm grower interested in your agri-inputs. Could you please share your catalogue and FOB pricing? I would also like to know the minimum order quantity and shipping options to India.\n\nThank you,\n[Your name]`
                    )}`}
                  >
                    <Ic name="send" size={14} /> Email
                  </a>
                )}
                {v.website && (
                  <a
                    className="fd-btn ghost"
                    style={{ textDecoration: "none" }}
                    href={v.website}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Ic name="globe" size={14} /> Website
                  </a>
                )}
                {v.phone && (
                  <a
                    className="fd-btn ghost"
                    style={{ textDecoration: "none" }}
                    href={`tel:${v.phone.replace(/\s+/g, "")}`}
                  >
                    <Ic name="phone" size={14} /> Call
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  /* =========================================================
     MY PRODUCTS (CRUD)
  ========================================================= */

  const renderMyProducts = () => (
    <div>
      <h2 className="fd-page-title">My Products</h2>
      <p className="fd-page-sub">Manage the produce you sell on E-Farm. Consumers see these instantly.</p>

      <div className="fd-card">
        <div className="fd-card-head">
          <div className="fd-card-title">{editingId ? "✏️ Edit Product" : "➕ Add New Product"}</div>
          {editingId && (
            <button className="fd-link-btn" onClick={() => {
              setEditingId(null);
              setProductName(""); setProductPrice(""); setProductQty(""); setProductDesc(""); setProductImg("");
              setProductUnit("kg");
              setAiPriceResult(null);
            }}>
              Cancel editing
            </button>
          )}
        </div>
        <div className="fd-form">
          <div>
            <label>Product Name</label>
            <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. Fresh Tomatoes" />
          </div>
          <div>
            <label>Category</label>
            <select value={productCategory} onChange={(e) => setProductCategory(e.target.value)}>
              {STORE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label>Price (₹)</label>
            <div className="fd-price-wrap">
              <input type="number" min="0" value={productPrice} onChange={(e) => setProductPrice(e.target.value)} placeholder="e.g. 40" />
              <select value={productUnit} onChange={(e) => setProductUnit(e.target.value)} title="What does this price mean?">
                <option value="kg">₹ / kg</option>
                <option value="unit">₹ / unit</option>
              </select>
              <button type="button" className="fd-ai-btn" onClick={runFairPriceAI} disabled={aiPriceLoading} title="AI suggests a fair price from live mandi rates">
                {aiPriceLoading ? "…" : "✨ AI"}
              </button>
            </div>
          </div>
          <div>
            <label>Quantity</label>
            <div className="fd-price-wrap">
              <input type="number" min="0" value={productQty} onChange={(e) => setProductQty(e.target.value)} placeholder="e.g. 100" />
              <select value={productUnit} onChange={(e) => setProductUnit(e.target.value)} title="Quantity unit">
                <option value="kg">kg</option>
                <option value="unit">units</option>
              </select>
            </div>
          </div>
          <div className="full">
            <label>Description</label>
            <textarea value={productDesc} onChange={(e) => setProductDesc(e.target.value)} placeholder="Describe quality, organic status, packing..." />
          </div>
          <div className="full">
            <label>Image URL (optional)</label>
            <input value={productImg} onChange={(e) => setProductImg(e.target.value)} placeholder="https://..." />
          </div>
          <div className="full">
            <button className="fd-btn primary" onClick={saveProduct} disabled={savingProduct}>
              {savingProduct ? "SAVING..." : editingId ? "UPDATE PRODUCT" : "ADD PRODUCT"}
            </button>
          </div>
          {(aiPriceLoading || aiPriceResult) && (
            <div className="full">
              {aiPriceLoading && (
                <div className="fd-ai-panel loading">
                  🤖 Analyzing live mandi rates, trends and your listing…
                </div>
              )}
              {aiPriceResult && !aiPriceLoading && (
                <div className="fd-ai-panel">
                  <div className="fd-ai-panel-head">✨ AI Fair Price Analysis</div>
                  {aiPriceResult.matched ? (
                    <>
                      <div className="fd-ai-mandi">
                        <span>🏛️ Mandi: <b>₹{aiPriceResult.mandiQuintal}/q</b> (₹{aiPriceResult.mandiKg}/kg)</span>
                        <span>{aiPriceResult.trendPct >= 0 ? "📈" : "📉"} 6-mo: <b>{aiPriceResult.trendPct >= 0 ? "+" : ""}{aiPriceResult.trendPct.toFixed(1)}%</b></span>
                        {aiPriceResult.unit === "kg" ? (
                          <span className={`fd-chip ${aiPriceResult.advice === "high" ? "blue" : aiPriceResult.advice === "low" ? "amber" : "green"}`}>
                            {aiPriceResult.advice === "high" ? "Your price is above market" : aiPriceResult.advice === "low" ? "Your price is below market" : "No price set yet"}
                          </span>
                        ) : (
                          <span className="fd-chip gray">₹/kg reference · you sell per unit</span>
                        )}
                      </div>
                      {aiPriceResult.unit === "kg" && (
                        <div className="fd-ai-picks">
                          <button type="button" className="fd-ai-pick" onClick={() => applyAiPrice(aiPriceResult.budget)}>
                            ₹{aiPriceResult.budget}/kg <small>Budget · quick sale</small>
                          </button>
                          <button type="button" className="fd-ai-pick main" onClick={() => applyAiPrice(aiPriceResult.fair)}>
                            ₹{aiPriceResult.fair}/kg <small>⭐ Fair · recommended</small>
                          </button>
                          <button type="button" className="fd-ai-pick" onClick={() => applyAiPrice(aiPriceResult.premium)}>
                            ₹{aiPriceResult.premium}/kg <small>Premium · top quality</small>
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div>
                      🤔 No mandi rate found for "{aiPriceResult.name}" in the E-Farm market dataset.
                      {aiPriceResult.hasKey ? " The live AI analysis is below." : " Connect an AI key in the AI Assistant page for a full analysis, or try a common crop name (wheat, tomato, onion…)."}
                    </div>
                  )}
                  <ul className="fd-ai-bullets">
                    {(aiPriceResult.bullets || []).map((b, i) => (
                      <li key={i}>{b.replace(/\*\*/g, "")}</li>
                    ))}
                  </ul>
                  {aiPriceResult.aiText && <div className="fd-ai-note">🤖 <b>Live AI:</b>{" "}{aiPriceResult.aiText}</div>}
                  <div className="fd-ai-offline">Powered by E-Farm market engine{aiPriceResult.hasKey ? " + live AI" : " (offline mode — no API key needed)"}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="fd-card" style={{ marginTop: 16 }}>
        <div className="fd-card-head">
          <div className="fd-card-title">My Listings ({myProducts.length})</div>
        </div>
        {myProducts.length === 0 && (
          <div className="fd-empty">
            <div className="fd-empty-art">📦</div>
            You have no products yet. Add your first product above.
          </div>
        )}
        {myProducts.map((p) => {
          if (!p) return null;
          const chip = p.inStock ? { label: "In Stock", cls: "green" } : { label: "Out of Stock", cls: "red" };
          const fair = evaluatePrice(p.name, p.category, p.price, p.unit);
          return (
            <div className="fd-list-row" key={p.id}>
              <div className="fd-mini-art">
                {p.imageUrl ? <img src={p.imageUrl} alt={p.name} /> : <span>{categoryIconOf(p.category)}</span>}
              </div>
              <div className="fd-list-main">
                <div className="fd-list-title">{p.name}</div>
                <div className="fd-list-sub">{p.category} • {rupee(p.price)}{unitSuffixOf(p.unit)} • Qty: {p.quantity}{qtyUnitOf(p.unit)} • {fmtDate(p.createdAt?.seconds)}</div>
              </div>
              <span className={`fd-chip ${chip.cls}`}>{chip.label}</span>
              {fair && (
                <span
                  className={`fd-chip ${fair.cls}`}
                  title={`AI fair price ≈ ₹${fair.fair}/kg • mandi ₹${fair.mandiKg}/kg`}
                  style={{ cursor: "default" }}
                >
                  ✨ {fair.label}
                </span>
              )}
              <div className="fd-actions">
                <button className="fd-btn ghost" onClick={() => startEditProduct(p)}><Ic name="edit" size={13} /> Edit</button>
                <button className="fd-btn danger" onClick={() => deleteProduct(p.id)}><Ic name="trash" size={13} /> Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  /* =========================================================
     INCOMING ORDERS (consumer → farmer)
  ========================================================= */

  const renderIncoming = () => (
    <div>
      <h2 className="fd-page-title">Incoming Orders</h2>
      <p className="fd-page-sub">Orders consumers placed for your produce. Accept to notify delivery partners.</p>

      {visibleIncomingOrders.some((o) => o.status === "delivered" || o.status === "rejected") && (
        <div style={{ marginBottom: 14 }}>
          <button className="fd-btn ghost" onClick={clearFarmerHistory}>
            <Ic name="trash" size={13} /> Clear History
          </button>
        </div>
      )}

      <div className="fd-card">
        {visibleIncomingOrders.length === 0 && (
          <div className="fd-empty">
            <div className="fd-empty-art">📥</div>
            No orders yet. Once consumers order your produce, they appear here.
          </div>
        )}

        {visibleIncomingOrders.map((o) => {
          const chip = statusChipOf(o.status);
          const orderValue = Number(o.totalAmount) || Number(o.price) * Number(o.quantity) || 0;
          const commission = calcCommission(orderValue);
          /* The farmer's CURRENT profile location overrides the
             farmLocation snapshot frozen on the order at
             checkout — an order placed while the farm location
             was wrong (or before it was saved) kept showing a
             huge distance even after the farmer fixed it.     */
          const tripKm = getTripKm(
            o,
            profile?.location,
            profile?.location
          );
          return (
            <div className="fd-list-row" key={o.id}>
              <div className="fd-mini-art">🛒</div>
              <div className="fd-list-main">
                <div className="fd-list-title">{o.productName || "Produce order"} • {rupee(o.totalAmount || Number(o.price) * Number(o.quantity))}</div>
                <div className="fd-list-sub">
                  {o.consumerName || "Consumer"} ({o.consumerPhone || "no phone"}) • Qty: {o.quantity ?? (o.itemCount ? `${o.itemCount} item(s)` : "—")}{o.unit === "kg" ? " kg" : ""}
                  {tripKm != null && <span> • 📏 {tripKm} km to consumer</span>}
                </div>
                <div className="fd-list-sub">
                  📍 {o.address || "—"}, {o.city || "—"} {o.pincode || ""} • {fmtDate(o.createdAt?.seconds)}
                </div>
                {o.status === "delivered" && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "#e8f5e9",
                      border: "1px solid #b9e8c5",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#15803d",
                    }}
                  >
                    ✅ Your product reached the consumer successfully
                    {o.deliveredAt
                      ? ` on ${fmtDate(
                          o.deliveredAt?.seconds || o.deliveredAt
                        )}`
                      : ""}
                    {o.deliveryPersonName
                      ? ` • delivered by ${o.deliveryPersonName}`
                      : ""}
                  </div>
                )}
                <div className="fd-list-sub">
                  🤝 Delivery partner earns {rupee(commission)} commission (5% of {rupee(orderValue)}) • 💵 Your payout after commission: {rupee(Math.max(0, orderValue - commission))}
                </div>
              </div>
              <span className={`fd-chip ${chip.cls}`}>{chip.label}</span>
              <div className="fd-actions">
                {o.status === "pending" && (
                  <>
                    <button className="fd-btn primary" disabled={updatingOrder === o.id} onClick={() => acceptIncomingOrder(o)}>
                      ✔ Accept
                    </button>
                    <button className="fd-btn danger" disabled={updatingOrder === o.id} onClick={() => doUpdateStatus(o.id, "rejected")}>
                      ✖ Reject
                    </button>
                  </>
                )}
                {o.status === "accepted" && (
                  <button className="fd-btn primary" disabled={updatingOrder === o.id} onClick={() => doUpdateStatus(o.id, "delivered")}>
                    📦 Mark Delivered
                  </button>
                )}
                {o.status === "delivered" && (
                  <span className="fd-list-sub" style={{ color: "#15803d", fontWeight: 700 }}>
                    ✅ Reached consumer {o.deliveredAt ? `on ${fmtDate(o.deliveredAt?.seconds || o.deliveredAt)}` : "successfully"}
                  </span>
                )}
                {o.status === "delivered" && (
                  <button className="fd-btn ghost" disabled={updatingOrder === o.id} onClick={() => removeOrderHistory(o.id)}>
                    <Ic name="trash" size={13} /> Clear
                  </button>
                )}
                {o.status === "rejected" && (
                  <span className="fd-list-sub">Response sent</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  /* =========================================================
     MY ORDERS (input purchases)
  ========================================================= */

  const renderMyOrders = () => (
    <div>
      <h2 className="fd-page-title">My Orders</h2>
      <p className="fd-page-sub">Agri-input purchases you made from the marketplace.</p>

      <div className="fd-card">
        {allInputOrders.length === 0 && (
          <div className="fd-empty">
            <div className="fd-empty-art">🧾</div>
            You haven't ordered any inputs yet.<br />
            <div style={{ marginTop: 12 }}>
              <button className="fd-btn primary" onClick={() => goBrowse()}>Browse Products</button>
            </div>
          </div>
        )}

        {allInputOrders.map((o) => {
          const chip = statusChipOf(o.status);
          const firstItem = o.items && o.items[0] ? o.items[0].name : "Input order";
          const more = o.items && o.items.length > 1 ? ` +${o.items.length - 1} more` : "";
          return (
            <div className="fd-list-row" key={o.id}>
              <div className="fd-mini-art">🧾</div>
              <div className="fd-list-main">
                <div className="fd-list-title">Order #{String(o.id).slice(-6).toUpperCase()}</div>
                <div className="fd-list-sub">{firstItem}{more} • {o.itemCount || (o.items ? o.items.length : 0)} item(s) • {rupee(o.totalAmount)}</div>
                <div className="fd-list-sub">📍 {o.address || "—"}, {o.city || "—"} • {fmtDate(o.createdAt?.seconds)}</div>
              </div>
              <span className={`fd-chip ${chip.cls}`}>{chip.label}</span>
              <div className="fd-actions">
                <button className="fd-btn ghost" onClick={() => go("track")}>Track</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  /* =========================================================
     TRACK ORDERS
  ========================================================= */

  const renderTrack = () => {
    const steps = ["Placed", "Confirmed", "Out for Delivery", "Delivered"];
    const trackItems = [
      ...visibleIncomingOrders.slice(0, 4).map((o) => ({
        key: "io-" + o.id,
        type: "Produce sale",
        title: o.productName || "Produce order",
        sub: `Buyer: ${o.consumerName || "Consumer"} • ${rupee(o.totalAmount || Number(o.price) * Number(o.quantity))}`,
        stage: o.status === "delivered" ? 4 : o.status === "accepted" ? 2 : 1,
        date: fmtDate(o.createdAt?.seconds),
      })),
      ...allInputOrders.slice(0, 4).map((o) => ({
        key: "in-" + o.id,
        type: "Input purchase",
        title: o.items && o.items[0] ? o.items[0].name + (o.items.length > 1 ? ` +${o.items.length - 1} more` : "") : "Input order",
        sub: `Total: ${rupee(o.totalAmount)}`,
        stage: o.status === "delivered" ? 4 : 2,
        date: fmtDate(o.createdAt?.seconds),
      })),
    ];

    return (
      <div>
        <h2 className="fd-page-title">Track Orders</h2>
        <p className="fd-page-sub">Live status of your produce sales and input purchases.</p>

        <div className="fd-card">
          {trackItems.length === 0 && (
            <div className="fd-empty">
              <div className="fd-empty-art">🚚</div>
              Nothing to track yet. Orders appear here once placed.
            </div>
          )}
          {trackItems.map((t) => (
            <div className="fd-list-row" key={t.key} style={{ display: "block" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span className="fd-tag">{t.type}</span>
                <div className="fd-list-title">{t.title}</div>
                <span className="fd-list-sub">{t.sub} • {t.date}</span>
              </div>
              <div className="fd-stepper">
                {steps.map((s, i) => (
                  <span key={s} style={{ display: "flex", alignItems: "center" }}>
                    <span className={`fd-step ${i < t.stage ? "done" : ""}`}>
                      <span className="fd-step-dot">{i < t.stage ? "✓" : i + 1}</span>
                      {s}
                    </span>
                    {i < steps.length - 1 && <span className={`fd-step-line ${i < t.stage - 1 ? "done" : ""}`}></span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  /* =========================================================
     SAVED ITEMS
  ========================================================= */

  const renderSaved = () => (
    <div>
      <h2 className="fd-page-title">Saved Items</h2>
      <p className="fd-page-sub">Products you saved for later — tap ❤️ on any product to add it here.</p>

      {savedProducts.length === 0 ? (
        <div className="fd-empty">
          <div className="fd-empty-art">🤍</div>
          No saved items yet.
          <div style={{ marginTop: 14 }}>
            <button className="fd-btn primary" onClick={() => goBrowse()}>Browse Products</button>
          </div>
        </div>
      ) : (
        <div className="fd-prod-grid">
          {savedProducts.map(renderProductCard)}
        </div>
      )}
    </div>
  );

  /* =========================================================
     CROP CALENDAR (full year)
  ========================================================= */

  const renderCalendarPage = () => (
    <div>
      <h2 className="fd-page-title">Crop Calendar</h2>
      <p className="fd-page-sub">Month-by-month farm tasks for the full year.</p>

      <div className="fd-card" style={{ marginBottom: 16 }}>
        <div className="fd-card-head">
          <div className="fd-card-title">Focus — {calMonth}</div>
        </div>
        <div className="fd-months">
          {MONTHS.map((m) => (
            <button key={m} className={`fd-month-tab ${calMonth === m ? "active" : ""}`} onClick={() => setCalMonth(m)}>
              {m}
            </button>
          ))}
        </div>
        {(SEASONAL_TASKS[calMonth] || []).map((t) => (
          <div className="fd-task" key={t[1]}>
            <div className="fd-task-icon">{t[0]}</div>
            <div>
              <div className="fd-task-title">{t[1]}</div>
              <div className="fd-task-desc">{t[2]}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="fd-cal-grid">
        {MONTHS.map((m) => (
          <div className="fd-card" key={m} style={{ padding: 16 }}>
            <div className="fd-card-title" style={{ marginBottom: 8 }}>{m}</div>
            {(SEASONAL_TASKS[m] || []).map((t) => (
              <div className="fd-task" key={t[1]} style={{ padding: "7px 0" }}>
                <div className="fd-task-icon" style={{ width: 30, height: 30, fontSize: 14 }}>{t[0]}</div>
                <div>
                  <div className="fd-task-title" style={{ fontSize: 12 }}>{t[1]}</div>
                  <div className="fd-task-desc" style={{ fontSize: 10.5 }}>{t[2]}</div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  /* =========================================================
     FARMING GUIDES
  ========================================================= */

  const renderGuides = () => (
    <div>
      <h2 className="fd-page-title">Farming Guides</h2>
      <p className="fd-page-sub">Practical, field-tested guides — tap to expand.</p>
      {GUIDES.map((g) => (
        <div className="fd-guide-card" key={g.title}>
          <div className="fd-guide-head" onClick={() => setOpenGuide(openGuide === g.title ? null : g.title)}>
            <div className="fd-task-icon">{g.icon}</div>
            <div style={{ flex: 1 }}>
              <div className="fd-list-title">{g.title}</div>
              <div className="fd-list-sub">{g.tag}</div>
            </div>
            <Ic name={openGuide === g.title ? "chevD" : "chevR"} size={16} />
          </div>
          {openGuide === g.title && <div className="fd-guide-body">{g.body}</div>}
        </div>
      ))}
    </div>
  );

  /* =========================================================
     SUBSIDIES & SCHEMES
  ========================================================= */

  const renderSchemes = () => (
    <div>
      <h2 className="fd-page-title">Subsidies &amp; Schemes</h2>
      <p className="fd-page-sub">Government schemes every Indian farmer should know about.</p>
      <div className="fd-compare-grid">
        {SCHEMES.map((s) => (
          <div className="fd-scheme" key={s.name}>
            <div style={{ fontSize: 32 }}>{s.icon}</div>
            <div className="fd-scheme-name">{s.name}</div>
            <div className="fd-scheme-desc">{s.desc}</div>
            <span className="fd-scheme-benefit">{s.benefit}</span>
            <a className="fd-scheme-link" href={s.link} target="_blank" rel="noreferrer">
              Official website →
            </a>
          </div>
        ))}
      </div>
    </div>
  );

  /* =========================================================
     WEATHER UPDATES (Open-Meteo live data)
  ========================================================= */

  const renderWeatherPage = () => {
    const cond = WEATHER_CODES[weather.code] || ["Partly cloudy", "⛅"];
    return (
      <div>
        <h2 className="fd-page-title">Weather Updates</h2>
        <p className="fd-page-sub">Live conditions and a 7-day outlook for your farm location.</p>

        <div className="fd-dash-grid">
          <div className="fd-dash-side" style={{ maxWidth: 420 }}>
            <div className="fd-weather">
              <div className="fd-weather-head">
                <span>Current Weather</span>
                <Ic name="cloud" size={20} />
              </div>
              <div className="fd-weather-loc">
                <Ic name="pin" size={13} />
                {weather.loading ? "Loading location..." : weather.city}
              </div>
              <div className="fd-weather-art">{cond[1]}</div>
              <div className="fd-weather-temp">
                {weather.loading ? "—" : weather.temp}
                <small>°C</small>
              </div>
              <div className="fd-weather-cond">{weather.loading ? "Loading..." : cond[0]}</div>
              <div className="fd-weather-meta">
                <div><Ic name="drop" size={16} /><div><span>Humidity</span>{weather.loading ? "—" : `${weather.humidity}%`}</div></div>
                <div><Ic name="wind" size={16} /><div><span>Wind</span>{weather.loading ? "—" : `${weather.wind} km/h`}</div></div>
                <div><Ic name="cloud" size={16} /><div><span>Rain Chance</span>{weather.loading ? "—" : `${weather.rain}%`}</div></div>
              </div>
            </div>
            {weather.error && <div className="fd-toast err" style={{ position: "static" }}>{weather.error}</div>}
            <div className="fd-card">
              <div className="fd-card-title" style={{ marginBottom: 8 }}>📍 Wrong location?</div>
              <div className="fd-list-sub" style={{ marginBottom: 10 }}>
                Set your farm location and weather follows automatically.
              </div>
              <button className="fd-btn ghost" onClick={() => go("location")}>Location Settings</button>
            </div>
          </div>

          <div className="fd-dash-col">
            <div className="fd-card">
              <div className="fd-card-head">
                <div className="fd-card-title">7-Day Forecast</div>
              </div>
              {weather.daily.length === 0 ? (
                <div className="fd-notif-empty">{weather.loading ? "Loading forecast..." : "Forecast unavailable."}</div>
              ) : (
                <div className="fd-forecast-grid">
                  {weather.daily.map((d, i) => {
                    const c = WEATHER_CODES[d.code] || ["—", "🌤️"];
                    const day = new Date(d.date + "T12:00:00").toLocaleDateString("en-IN", { weekday: "short" });
                    return (
                      <div className="fd-fday" key={d.date}>
                        <div>{i === 0 ? "Today" : day}</div>
                        <div className="fd-ficon">{c[1]}</div>
                        <div className="fd-fmax">{d.max}°</div>
                        <div className="fd-fmin">{d.min}°</div>
                        <div className="fd-frain">💧 {d.rain}%</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="fd-card">
              <div className="fd-card-head">
                <div className="fd-card-title">Farming Advisory</div>
              </div>
              <div className="fd-list-sub" style={{ fontSize: 13, lineHeight: 1.7 }}>
                {!weather.loading && !weather.error && (
                  <>
                    {weather.rain >= 60
                      ? "🌧️ High rain chance this week — postpone urea top dressing and pesticide sprays, open field drainage channels and secure harvested produce."
                      : weather.rain >= 30
                        ? "🌦️ Moderate rain chance — keep irrigation flexible and monitor drainage. Safe window for light field work."
                        : "☀️ Mostly dry week — ideal for irrigation, spraying and harvest operations. Watch soil moisture on young crops."}{" "}
                    {weather.temp >= 38
                      ? "Heat stress likely — irrigate during early morning or evening hours."
                      : weather.temp <= 10
                        ? "Cool conditions — protect young plants from frost with light evening irrigation."
                        : "Temperatures are comfortable for field operations."}
                  </>
                )}
                {weather.loading && "Analyzing weather for your farm..."}
                {weather.error && "Weather advisory unavailable right now."}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  /* =========================================================
     AI CROP ASSISTANT (chat page)
  ========================================================= */

  const renderAI = () => (
    <div>
      <h2 className="fd-page-title">AI Crop Assistant</h2>
      <p className="fd-page-sub">
        Open-source AI that answers anything — farming, prices, weather, science or any general question.
      </p>

      {hasApiKey() ? (
        <div className="fd-ai-engine">
          <span>⚙️ Engine: {activeEngineLabel()}</span>
          <button
            type="button"
            className="fd-ai-engine-btn"
            onClick={() => {
              setStoredKey("");
              toast("AI key removed — running in Reference mode.");
            }}
          >
            Remove key
          </button>
        </div>
      ) : (
        <div className="fd-ai-setup">
          <div className="fd-ai-setup-title">
            🔌 Connect free open-source AI — 30 seconds, no credit card
          </div>
          <div className="fd-ai-setup-step">
            1️⃣ Get a key:{" "}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
              OpenRouter (recommended) ↗
            </a>{" "}
            ·{" "}
            <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
              Groq (fastest) ↗
            </a>{" "}
            — sign in with Google → Create key → copy it.
          </div>
          <div className="fd-ai-setup-row">
            <input
              value={aiKeyInput}
              onChange={(e) => setAiKeyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveAiKey(); }}
              placeholder="Paste your key here (sk-or-… / gsk_… / AIza…)"
            />
            <button type="button" className="fd-ai-setup-save" onClick={saveAiKey}>
              Connect
            </button>
          </div>
          <div className="fd-ai-setup-note">
            Until connected, I answer from the built-in farming knowledge base + live Wikipedia (Reference mode).
          </div>
        </div>
      )}

      <div className="fd-card">
        <div className="fd-chat">
          {aiMessages.map((m, i) => (
            <div key={i} className={`fd-msg ${m.role === "me" ? "me" : "bot"}`}>
              {m.role === "bot" && m.thinking ? (
                <details className="fd-ai-think">
                  <summary>🧠 View reasoning</summary>
                  <div className="fd-ai-think-body">{m.thinking}</div>
                </details>
              ) : null}
              <div dangerouslySetInnerHTML={{ __html: fmtAI(m.text) }} />
              {m.role === "bot" && m.sources && m.sources.length > 0 && (
                <div className="fd-ai-src">
                  📚 Compared sources:{" "}
                  {m.sources.map((s, j) => (
                    <a key={j} href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  ))}
                </div>
              )}
              {m.role === "bot" && m.provider && (
                <div className="fd-ai-provider">
                  ⚙️ {m.provider}
                  {m.model && m.model !== "-" ? ` · ${m.model}` : ""}
                </div>
              )}
            </div>
          ))}
          {aiTyping && <div className="fd-ai-typing">🧠 Thinking & comparing sources…</div>}
          <div ref={aiEndRef}></div>
        </div>

        <div className="fd-suggest">
          {["Wheat fertilizer dose", "Where to buy seeds in Bhopal", "Today's best mandi rates", "PM-KISAN scheme", "Compare organic vs chemical fertilizer", "Explain photosynthesis simply"].map((s) => (
            <button key={s} className="fd-suggest-chip" onClick={() => askAI(s)}>
              {s}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginTop: "12px",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="fd-suggest-chip"
            style={aiDeep ? { background: "#eef2ff", borderColor: "#6366f1", color: "#4338ca" } : undefined}
            onClick={() => setAiDeep(!aiDeep)}
            title="Use a reasoning model (DeepSeek R1 / Qwen 3) — slower but thinks step by step"
          >
            🧠 Deep Think: {aiDeep ? "ON" : "OFF"}
          </button>
          <span style={{ fontSize: "11px", color: "#6d7f72" }}>
            {aiDeep ? "Step-by-step reasoning — may take up to a minute" : "Fast answers"}
          </span>
        </div>

        <div className="fd-ai-mini" style={{ marginTop: 14 }}>
          <input
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            placeholder="Ask me anything — crops, prices, or any general question..."
            onKeyDown={(e) => { if (e.key === "Enter") askAI(); }}
          />
          <button className="fd-ai-send" onClick={() => askAI()}>
            <Ic name="send" size={17} />
          </button>
        </div>
      </div>
    </div>
  );

  /* =========================================================
     LOCATION SETTINGS
  ========================================================= */

  const renderLocation = () => (
    <div>
      <h2 className="fd-page-title">Location Settings</h2>
      <p className="fd-page-sub">Used for weather, delivery and order coordination.</p>

      <div className="fd-card">
        <div className="fd-form">
          <div className="full">
            <label>Address</label>
            <input value={locAddress} onChange={(e) => setLocAddress(e.target.value)} placeholder="Village, street" />
          </div>
          <div>
            <label>City</label>
            <input value={locCity} onChange={(e) => setLocCity(e.target.value)} placeholder="City" />
          </div>
          <div>
            <label>State</label>
            <input value={locState} onChange={(e) => setLocState(e.target.value)} placeholder="State" />
          </div>
          <div>
            <label>Pincode</label>
            <input value={locPincode} onChange={(e) => setLocPincode(e.target.value)} placeholder="Pincode" />
          </div>
          <div>
            <label>Latitude</label>
            <input value={locLat} onChange={(e) => setLocLat(e.target.value)} placeholder="e.g. 23.2599" />
          </div>
          <div>
            <label>Longitude</label>
            <input value={locLng} onChange={(e) => setLocLng(e.target.value)} placeholder="e.g. 77.4126" />
          </div>
        </div>
        <div className="fd-actions" style={{ marginTop: 16 }}>
          <button className="fd-btn ghost" onClick={getLocation}>📡 Use My Current Location</button>
          <button className="fd-btn primary" onClick={saveLocation} disabled={savingLocation}>
            {savingLocation ? "SAVING..." : "💾 Save Location"}
          </button>
        </div>
        {/* Farm map — drag the 📍 pin onto your farm. The browser
            GPS fix can be a city-level guess; the map pin is exact
            and you can SEE where you are pinning.                */}
        <LocationPicker
          latitude={locLat}
          longitude={locLng}
          centerHint={profile?.location || null}
          height={260}
          onChange={(lat, lng) => {
            setLocLat(lat.toFixed(6));
            setLocLng(lng.toFixed(6));
            toast("Farm location set from the map — remember to save 💾");
          }}
        />
      </div>
    </div>
  );

  /* =========================================================
     MAIN RENDER
  ========================================================= */

  return (
    <div className="fd-root">
      {renderSidebar()}
      <SupportChat role="farmer" />

      <div className="fd-main">
        {renderTopbar()}

        <motion.div
          className="fd-content"
          key={activeSection}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {activeSection === "dashboard" && renderDashboard()}
          {activeSection === "browse" && renderBrowse()}
          {activeSection === "categories" && renderCategories()}
          {activeSection === "compare" && renderCompare()}
          {activeSection === "sources" && renderSources()}
          {activeSection === "global" && renderGlobal()}
          {activeSection === "prices" && renderPrices()}
          {activeSection === "trends" && renderTrends()}
          {activeSection === "seasonal" && renderSeasonal()}
          {activeSection === "myproducts" && renderMyProducts()}
          {activeSection === "incoming" && renderIncoming()}
          {activeSection === "myorders" && renderMyOrders()}
          {activeSection === "track" && renderTrack()}
          {activeSection === "saved" && renderSaved()}
          {activeSection === "calendar" && renderCalendarPage()}
          {activeSection === "guides" && renderGuides()}
          {activeSection === "schemes" && renderSchemes()}
          {activeSection === "weather" && renderWeatherPage()}
          {activeSection === "ai" && renderAI()}
          {activeSection === "location" && renderLocation()}
        </motion.div>

        <footer className="fd-footer">
          <span>© 2025 E-Farm. All rights reserved.</span>
          <div className="fd-footer-links">
            <button onClick={() => toast("Privacy Policy — demo page")}>Privacy Policy</button>
            <button onClick={() => toast("Terms of Service — demo page")}>Terms of Service</button>
            <button onClick={() => go("ai")}>Contact Us</button>
          </div>
        </footer>
      </div>

      {cartOpen && <div className="fd-overlay" onClick={() => setCartOpen(false)}></div>}
      {cartOpen && renderCart()}

      {toasts.length > 0 && (
        <div className="fd-toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`fd-toast ${t.kind === "err" ? "err" : ""}`}>
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   SEASONAL CALENDAR TASKS
   ========================================================= */

const SEASONAL_TASKS = {
  Jan: [
    ["🌾", "Wheat Care", "Crown root irrigation & urea top-dressing"],
    ["🧪", "Field Prep", "Prepare summer vegetable beds"],
    ["🥬", "Vegetable Sowing", "Sow leafy greens & early summer crops"],
  ],
  Feb: [
    ["🚜", "Harvest Prep", "Prepare for mustard & gram harvest"],
    ["🧪", "Final Dose", "Last nitrogen dose for wheat"],
    ["☀️", "Heat Planning", "Plan summer fodder crops"],
  ],
  Mar: [
    ["🌾", "Rabi Harvest", "Harvest wheat & mustard"],
    ["📦", "Storage", "Store grain at safe moisture"],
    ["🌱", "Summer Sowing", "Sow moong & summer vegetables"],
  ],
  Apr: [
    ["💧", "Summer Irrigation", "Frequent light irrigations"],
    ["🧪", "Orchard Care", "Fertilize mango & citrus"],
    ["🚜", "Field Prep", "Prepare land for kharif"],
  ],
  May: [
    ["🚜", "Land Preparation", "Deep ploughing & harrowing for kharif"],
    ["🌧️", "Monsoon Prep", "Build bunds & clean water channels"],
    ["💧", "Water Mgmt", "Light irrigation for fruit trees"],
  ],
  Jun: [
    ["🌱", "Kharif Sowing", "Sow soybean, maize & cotton with monsoon"],
    ["🧪", "Seed Treatment", "Treat seeds with fungicide & Rhizobium"],
    ["💧", "Drainage", "Ensure proper field drainage"],
  ],
  Jul: [
    ["🌱", "Transplanting", "Transplant paddy seedlings"],
    ["🧪", "Basal Dose", "Apply DAP & zinc at sowing"],
    ["🐛", "Pest Watch", "Monitor stem borer & leaf hopper"],
  ],
  Aug: [
    ["🧪", "Top Dressing", "Split urea at tillering/vegetative stage"],
    ["🐛", "Pest Control", "Scout for bollworm & blast"],
    ["💧", "Water Mgmt", "Maintain standing water for paddy"],
  ],
  Sep: [
    ["🌾", "Crop Monitor", "Monitor grain filling & pest pressure"],
    ["🧪", "Final Dose", "Last urea dose before flowering"],
    ["🚜", "Equipment", "Service harvester & thresher"],
  ],
  Oct: [
    ["🌾", "Kharif Harvest", "Harvest soybean & early maize"],
    ["📦", "Grain Storage", "Dry & store grain at safe moisture"],
    ["🌱", "Rabi Prep", "Prepare fields for wheat sowing"],
  ],
  Nov: [
    ["🌱", "Rabi Sowing", "Sow wheat, gram & mustard"],
    ["🧪", "Basal Dose", "Full P&K + half N basal at sowing"],
    ["💧", "First Irrigation", "Crown root irrigation at 21 days"],
  ],
  Dec: [
    ["🧪", "Top Dressing", "Second urea dose at tillering"],
    ["🐛", "Disease Watch", "Monitor yellow rust in wheat"],
    ["💧", "Irrigation", "Irrigate at tillering stage"],
  ],
};

export default FarmerDashboard;
