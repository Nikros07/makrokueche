// Zutaten-Erkennung: Freitext → Menge, Einheit, Name → Lebensmittel.

import { round1 } from "./macros.js";

export function normalize(str) {
  return String(str ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SUFFIXES = ["en", "er", "n", "e", "s"];

// Mögliche Singular-/Stammformen durch Abschneiden einer Plural-Endung.
// Bei -s mindestens 3 Zeichen Rest, damit "Eis" nicht zu "Ei" wird.
function stems(s) {
  const out = new Set();
  for (const suf of SUFFIXES) {
    if (!s.endsWith(suf)) continue;
    const stem = s.slice(0, -suf.length);
    if (stem.length >= (suf === "s" ? 3 : 2) && !stem.endsWith(" ")) out.add(stem);
  }
  return out;
}

function candidatesOf(food) {
  const list = [food && food.name, ...((food && food.aliases) || [])];
  return list.map(normalize).filter(Boolean);
}

// Treffergüte eines Kandidaten: 1 = exakt (beste) … 4 = Wortmenge, 0 = kein Treffer.
// Abweichung zur Reihenfolge im Vertrag: Plural-Treffer steht VOR Präfix,
// damit "Eier" das "Ei" findet und nicht ein "Eier gekocht".
function tierOf(q, qWords, c) {
  if (c === q) return 1;
  if (stems(q).has(c) || stems(c).has(q)) return 2;
  // Präfix nur an Wortgrenzen: "Butter" trifft nie "Erdnussbutter", "Reis" nie "Preiselbeere".
  if (c.startsWith(q + " ") || q.startsWith(c + " ")) return 3;
  // Wortmenge nur bei mehreren Suchwörtern, sonst träfe "Wasser" jedes "… in Wasser".
  if (qWords.length >= 2) {
    const cWords = new Set(c.split(" "));
    if (qWords.every((w) => cWords.has(w))) return 4;
  }
  return 0;
}

export function findFood(query, foods) {
  const q = normalize(query);
  if (q.length < 2 || !Array.isArray(foods)) return null;
  const qWords = q.split(" ");
  let best = null;
  let bestTier = 0;
  for (const food of foods) {
    let tier = 0;
    for (const c of candidatesOf(food)) {
      const t = tierOf(q, qWords, c);
      if (t && (tier === 0 || t < tier)) tier = t;
    }
    if (!tier) continue;
    const better =
      bestTier === 0 ||
      tier < bestTier ||
      (tier === bestTier && String(food.name).length < String(best.name).length);
    if (better) {
      best = food;
      bestTier = tier;
    }
  }
  return best;
}

export function searchFoods(query, foods, limit = 8) {
  const q = normalize(query);
  if (!q || !Array.isArray(foods)) return [];
  const qWords = q.split(" ");
  const scored = [];
  for (const food of foods) {
    let best = 99;
    for (const c of candidatesOf(food)) {
      const cWords = c.split(" ");
      let t = 99;
      if (c === q) t = 0;
      else if (c.startsWith(q)) t = 1;
      else if (qWords.every((w) => cWords.some((cw) => cw.startsWith(w)))) t = 2;
      else if (c.includes(q)) t = 3;
      else if (stems(q).has(c) || stems(c).has(q)) t = 4;
      if (t < best) best = t;
    }
    if (best < 99) scored.push({ food, best });
  }
  scored.sort(
    (a, b) =>
      a.best - b.best ||
      String(a.food.name).length - String(b.food.name).length ||
      String(a.food.name).localeCompare(String(b.food.name), "de"),
  );
  return scored.slice(0, Math.max(0, limit)).map((s) => s.food);
}

export function splitIngredients(text) {
  return String(text ?? "")
    // Komma zwischen zwei Ziffern ist ein Dezimalkomma ("1,5 l"), kein Trenner.
    .split(/\r?\n|;|(?<!\d),|,(?!\d)|\s+und\s+/i)
    .map((s) => s.replace(/^[\s\-•*·]+/, "").trim())
    .filter(Boolean);
}

const UNITS = {
  g: "g", gr: "g", gramm: "g",
  kg: "kg", kilo: "kg", kilogramm: "kg",
  ml: "ml", milliliter: "ml",
  l: "l", liter: "l",
  el: "el", essloeffel: "el",
  tl: "tl", teeloeffel: "tl",
  stueck: "stueck", stk: "stueck", st: "stueck", stck: "stueck",
  scheibe: "scheibe", scheiben: "scheibe",
  becher: "becher",
  tasse: "tasse", tassen: "tasse",
  handvoll: "handvoll",
  zehe: "zehe", zehen: "zehe",
  dose: "dose", dosen: "dose",
  bund: "bund",
  prise: "prise", prisen: "prise",
};

const NUMBER_WORDS = {
  ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5,
  halbe: 0.5, halber: 0.5, halbes: 0.5,
};
const UNICODE_FRACTIONS = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
const WORD = "A-Za-zÄÖÜäöüß";

// Liest eine Menge am Textanfang. → { value, rest } oder null.
function readNumber(t) {
  let m = t.match(/^(\d+)?\s*([½¼¾⅓⅔])\s*/);
  if (m) return { value: (m[1] ? Number(m[1]) : 0) + UNICODE_FRACTIONS[m[2]], rest: t.slice(m[0].length) };
  m = t.match(/^(\d+)\s+(\d+)\/(\d+)(?![\d/])\s*/);
  if (m && Number(m[3]) > 0) return { value: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: t.slice(m[0].length) };
  m = t.match(/^(\d+)\/(\d+)(?![\d/])\s*/);
  if (m && Number(m[2]) > 0) return { value: Number(m[1]) / Number(m[2]), rest: t.slice(m[0].length) };
  m = t.match(/^(\d+(?:[.,]\d+)?)\s*/);
  if (m) return { value: Number(m[1].replace(",", ".")), rest: t.slice(m[0].length) };
  m = t.match(new RegExp(`^([${WORD}]+)(?=\\s|$)\\s*`));
  if (m) {
    const w = normalize(m[1]);
    if (Object.hasOwn(NUMBER_WORDS, w)) {
      let value = NUMBER_WORDS[w];
      let rest = t.slice(m[0].length);
      const half = rest.match(/^halb(?:e|er|es)(?=\s|$)\s*/i);
      if (half && value === 1) {
        value = 0.5;
        rest = rest.slice(half[0].length);
      }
      return { value, rest };
    }
  }
  return null;
}

// Liest eine Einheit am Textanfang. → { unit, rest } (unit kann null sein).
function readUnit(t) {
  const m = t.match(new RegExp(`^([${WORD}]+)\\.?(?=\\s|$|[^${WORD}])\\s*`));
  if (m) {
    const key = normalize(m[1]);
    if (Object.hasOwn(UNITS, key)) return { unit: UNITS[key], rest: t.slice(m[0].length) };
  }
  return { unit: null, rest: t };
}

function cleanName(s) {
  return s
    .replace(/^(?:von|vom)\s+/i, "")
    .replace(/^[\s,.;:]+|[\s,.;:]+$/g, "")
    .trim();
}

export function parseLine(text) {
  let t = String(text ?? "").replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:ca\.?|circa|etwa)\s+/i, "");
  const first = readNumber(t);
  if (first) {
    const { unit, rest } = readUnit(first.rest);
    return { amount: first.value, unit, name: cleanName(rest) };
  }
  // Umgekehrte Reihenfolge: "Rinderhack 200 g" (Einheit Pflicht, sonst wäre "Mehl Type 405" falsch)
  const m = t.match(new RegExp(`^(.+?)\\s+(\\d+/\\d+|\\d+(?:[.,]\\d+)?)\\s*([${WORD}]+)\\.?$`));
  if (m && Object.hasOwn(UNITS, normalize(m[3]))) {
    const amount = m[2].includes("/")
      ? Number(m[2].split("/")[0]) / Number(m[2].split("/")[1])
      : Number(m[2].replace(",", "."));
    if (Number.isFinite(amount)) return { amount, unit: UNITS[normalize(m[3])], name: cleanName(m[1]) };
  }
  return { amount: 1, unit: null, name: cleanName(t) };
}

export function toGrams(parsed, food) {
  const amount = Number(parsed && parsed.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const units = (food && food.units) || {};
  const unit = parsed.unit ?? null;
  const factor = (key) => (Number.isFinite(units[key]) && units[key] > 0 ? units[key] : null);
  let grams = null;
  if (unit === "g") grams = amount;
  else if (unit === "kg") grams = amount * 1000;
  else if (unit === "ml") grams = amount * (factor("ml") ?? 1);
  else if (unit === "l") grams = amount * 1000 * (factor("ml") ?? 1);
  else {
    const f = factor(unit === null ? "stueck" : unit);
    if (f !== null) grams = amount * f;
  }
  return grams === null ? null : round1(grams);
}

export function parseIngredientsLocal(text, foods) {
  const ingredients = [];
  const warnings = [];
  for (const piece of splitIngredients(text)) {
    const parsed = parseLine(piece);
    if (!parsed.name) {
      warnings.push(`„${piece}" nicht erkannt`);
      continue;
    }
    const food = findFood(parsed.name, foods);
    if (!food) {
      warnings.push(`„${parsed.name}" nicht erkannt`);
      continue;
    }
    const grams = toGrams(parsed, food);
    if (grams === null || grams <= 0) {
      warnings.push(`Menge für „${parsed.name}" unklar`);
      continue;
    }
    const p = food.per100 || {};
    ingredients.push({
      name: parsed.name,
      grams,
      foodId: food.id,
      per100: {
        kcal: Number(p.kcal) || 0,
        protein: Number(p.protein) || 0,
        fat: Number(p.fat) || 0,
        carbs: Number(p.carbs) || 0,
        fiber: Number(p.fiber) || 0,
      },
      source: "db",
      note: "",
    });
  }
  return { ingredients, warnings };
}
