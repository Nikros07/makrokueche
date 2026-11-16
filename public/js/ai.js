// KI-Kette im Browser: Gemini (Interactions API) → OpenRouter → lokaler Parser.
// An die KI geht nur Anweisung + Liste "id|name" + Zutatentext. Keys werden nie geloggt oder zurückgegeben.
import { findFood, parseIngredientsLocal } from './core/foodmatch.js';
import { checkPer100 } from './core/macros.js';

const TIMEOUT_MS = 20_000;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';

export const ITEMS_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          grams: { type: 'number' },
          foodId: { type: 'string' },
          kcal: { type: 'number' },
          protein: { type: 'number' },
          fat: { type: 'number' },
          carbs: { type: 'number' },
          fiber: { type: 'number' },
        },
        required: ['name', 'grams', 'foodId', 'kcal', 'protein', 'fat', 'carbs', 'fiber'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

export function buildPrompt(text, foods) {
  const list = foods.map((f) => `${f.id}|${f.name}`).join('\n');
  return [
    'Du bist ein Ernährungs-Assistent. Zerlege den folgenden Zutatentext in einzelne Zutaten.',
    'Regeln:',
    '- Rechne jede Menge in Gramm um. Stückzahlen, EL, TL, ml, Prise, Handvoll usw. schätze sinnvoll in Gramm (grams).',
    '- foodId darf nur eine id aus der folgenden Liste sein, sonst ein leerer String "".',
    '- kcal, protein, fat, carbs, fiber sind deine Schätzung der Nährwerte je 100 g der Zutat.',
    '- carbs sind verwertbare Kohlenhydrate OHNE Ballaststoffe (Ballaststoffe stehen in fiber).',
    '- name ist der kurze deutsche Name der Zutat ohne Mengenangabe.',
    '- Gib ausschließlich JSON im Format {"items":[{"name":"","grams":0,"foodId":"","kcal":0,"protein":0,"fat":0,"carbs":0,"fiber":0}]} aus, ohne Erklärungen.',
    '',
    'Lebensmittel-Liste (id|name):',
    list,
    '',
    'Zutatentext:',
    text,
  ].join('\n');
}

async function fetchJson(fetchImpl, url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    if (!res || !res.ok) throw new Error(`Antwort ${res ? res.status : 'leer'}`);
    return await res.json();
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Zeitüberschreitung');
    // Nur eine kurze Meldung, keine Details (könnten URL oder Header enthalten).
    throw new Error(e && /^Antwort /.test(e.message) ? e.message : 'Anfrage fehlgeschlagen');
  } finally {
    clearTimeout(timer);
  }
}

// Erstes {...} aus dem Text ziehen (auch aus ```-Zaun oder mit Vortext).
export function extractJson(text) {
  if (typeof text !== 'string') throw new Error('kein Text');
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* weiter */ }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('kein JSON');
  return JSON.parse(trimmed.slice(start, end + 1));
}

// Gemini-Antwort tolerant lesen: steps[] (model_output) → output_text → outputs[].
function geminiText(data) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s && s.type === 'model_output' && Array.isArray(s.content)) {
      return s.content.filter((c) => c && typeof c.text === 'string').map((c) => c.text).join('');
    }
  }
  if (typeof data?.output_text === 'string' && data.output_text) return data.output_text;
  if (Array.isArray(data?.outputs)) {
    const text = data.outputs.filter((o) => o && typeof o.text === 'string').map((o) => o.text).join('');
    if (text) return text;
  }
  throw new Error('keine Antwort');
}

async function askGemini(prompt, env, fetchImpl) {
  // Kein Api-Revision-Header: der würde im Browser den CORS-Preflight scheitern lassen.
  const data = await fetchJson(fetchImpl, GEMINI_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': env.GEMINI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      input: prompt,
      response_format: { type: 'text', mime_type: 'application/json', schema: ITEMS_SCHEMA },
    }),
  });
  return extractJson(geminiText(data));
}

async function askOpenRouter(prompt, env, fetchImpl) {
  const data = await fetchJson(fetchImpl, OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_schema', json_schema: { name: 'zutaten', strict: true, schema: ITEMS_SCHEMA } },
    }),
  });
  return extractJson(data?.choices?.[0]?.message?.content);
}

// Gratis-Modelle liefern Zahlen manchmal als Text ("200" oder "12,5"), deshalb tolerant lesen.
const toNumber = (v) => (typeof v === 'string' ? Number(v.trim().replace(',', '.')) : v);
const num = (v) => {
  const n = toNumber(v);
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0;
};

// Items der KI prüfen und in Ingredient-Objekte umwandeln.
export function processItems(items, foods) {
  if (!Array.isArray(items)) throw new Error('keine Liste');
  const byId = new Map(foods.map((f) => [f.id, f]));
  const ingredients = [];
  const warnings = [];
  for (const it of items) {
    const name = typeof it?.name === 'string' ? it.name.trim().slice(0, 120) : '';
    if (!name) continue;
    const grams = toNumber(it.grams);
    if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0 || grams > 5000) {
      warnings.push(`„${name}“ verworfen: Menge nicht plausibel.`);
      continue;
    }
    const g = Math.round(grams * 10) / 10;
    const food = (typeof it.foodId === 'string' && byId.get(it.foodId)) || findFood(name, foods) || null;
    if (food) {
      ingredients.push({ name, grams: g, foodId: food.id, per100: { ...food.per100 }, source: 'db', note: '' });
      continue;
    }
    const est = { kcal: num(it.kcal), protein: num(it.protein), fat: num(it.fat), carbs: num(it.carbs), fiber: num(it.fiber) };
    const check = checkPer100(est);
    let per100 = est;
    let note = 'KI-Schätzung';
    if (!check.ok) {
      per100 = { ...check.fixed };
      note = 'KI-Schätzung, kcal korrigiert';
      warnings.push(`Nährwerte für „${name}“ waren unstimmig und wurden korrigiert.`);
    }
    ingredients.push({ name, grams: g, foodId: null, per100, source: 'ai', note });
  }
  return { ingredients, warnings };
}

export async function parseIngredients(text, { env = {}, fetchImpl = (...a) => globalThis.fetch(...a), foods = [] } = {}) {
  const prompt = buildPrompt(text, foods);
  const providers = [
    ['Gemini', 'gemini', env.GEMINI_API_KEY, askGemini],
    ['OpenRouter', 'openrouter', env.OPENROUTER_API_KEY, askOpenRouter],
  ];
  const failed = [];
  for (const [label, id, key, ask] of providers) {
    if (!key) continue;
    try {
      const raw = await ask(prompt, env, fetchImpl);
      const { ingredients, warnings } = processItems(raw?.items, foods);
      if (!ingredients.length) throw new Error('keine Zutaten');
      const head = failed.length ? [`${failed.join(' und ')} nicht erreichbar, ${label} verwendet`] : [];
      return { ingredients, provider: id, warnings: [...head, ...warnings] };
    } catch (e) {
      failed.push(label);
      // Grund nur in der Konsole (Status oder Kurzmeldung, nie Key oder Header).
      console.warn(`[ki] ${label}: ${String(e?.message || 'Fehler').slice(0, 200)}`);
    }
  }
  const local = parseIngredientsLocal(text, foods);
  const head = failed.length
    ? `${failed.join(' und ')} nicht erreichbar, lokaler Parser verwendet`
    : 'Keine KI konfiguriert, lokaler Parser verwendet';
  return { ingredients: local.ingredients, provider: 'lokal', warnings: [head, ...(local.warnings || [])] };
}
