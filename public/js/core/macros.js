// Makro-Rechnung. Reine Funktionen, keine Mutation der Eingaben.

const KEYS = ["kcal", "protein", "fat", "carbs", "fiber"];

// Fehlende oder ungültige Werte zählen als 0.
function num(x) {
  const n = typeof x === "string" ? Number(x.replace(",", ".")) : Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function round1(n) {
  return Math.round(num(n) * 10) / 10 || 0;
}

export function atwaterKcal(per100) {
  const p = per100 || {};
  return 4 * num(p.protein) + 4 * num(p.carbs) + 9 * num(p.fat) + 2 * num(p.fiber);
}

export function checkPer100(per100) {
  const src = per100 || {};
  const problems = [];
  const fixed = {};
  for (const k of KEYS) fixed[k] = num(src[k]);

  const labels = { kcal: "Kalorien", protein: "Eiweiß", fat: "Fett", carbs: "Kohlenhydrate", fiber: "Ballaststoffe" };
  for (const k of KEYS) {
    if (fixed[k] < 0) {
      problems.push(`${labels[k]} dürfen nicht negativ sein`);
      fixed[k] = 0;
    }
  }
  for (const k of ["protein", "fat", "carbs", "fiber"]) {
    if (fixed[k] > 100) {
      problems.push(`${labels[k]} über 100 g je 100 g`);
      fixed[k] = 100;
    }
  }
  if (fixed.kcal > 900) {
    problems.push("Kalorien über 900 kcal je 100 g");
    fixed.kcal = 900;
  }
  const sum = fixed.protein + fixed.fat + fixed.carbs + fixed.fiber;
  if (sum > 102) {
    problems.push(`Eiweiß, Fett, Kohlenhydrate und Ballaststoffe ergeben zusammen ${round1(sum)} g (mehr als 100 g)`);
  }
  const atwater = atwaterKcal(fixed);
  const tolerance = Math.max(25, 0.2 * atwater);
  if (Math.abs(fixed.kcal - atwater) > tolerance) {
    fixed.kcal = Math.round(atwater);
    problems.push(`Kalorien passen nicht zu den Makros, korrigiert auf ${fixed.kcal} kcal`);
  }
  return { ok: problems.length === 0, problems, fixed };
}

export function ingredientMacros(ing) {
  const grams = Math.max(0, num(ing && ing.grams));
  const p = (ing && ing.per100) || {};
  const out = {};
  for (const k of KEYS) out[k] = (num(p[k]) * grams) / 100;
  return out;
}

export function sumMacros(ingredients) {
  const total = { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 };
  for (const ing of ingredients || []) {
    const m = ingredientMacros(ing);
    for (const k of KEYS) total[k] += m[k];
  }
  return total;
}

export function perPortion(total, portions) {
  const n = num(portions);
  const div = n < 1 ? 1 : n;
  const out = {};
  for (const k of KEYS) out[k] = num(total && total[k]) / div;
  return out;
}

// Energieanteile aus 4/4/9 kcal je g, damit die Summe immer ≈ 100 ergibt.
export function macroPercents(m) {
  const p = 4 * Math.max(0, num(m && m.protein));
  const f = 9 * Math.max(0, num(m && m.fat));
  const c = 4 * Math.max(0, num(m && m.carbs));
  const e = p + f + c;
  if (e <= 0) return { protein: 0, fat: 0, carbs: 0 };
  return { protein: round1((p / e) * 100), fat: round1((f / e) * 100), carbs: round1((c / e) * 100) };
}
