// Persistenz im Browser (localStorage) samt Validierung. Reines ES-Modul, läuft auch in Node (mit Fake-Storage).
// Synchron; ungültige Eingaben werfen Error mit deutschem Text.

const STATE_KEY = 'makrokueche.state.v1';
const BROKEN_KEY = 'makrokueche.state.kaputt';
const SETTINGS_KEY = 'makrokueche.settings.v1';
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';
const WRITE_ERROR = 'Speichern im Browser nicht möglich. Ist der Speicher voll oder gesperrt?';

export function emptyState() {
  return { profile: null, weights: [], recipes: [], shopping: { selections: [], manual: [], checked: {} } };
}

// ---------- Validierung ----------

const bad = (msg) => new Error(msg);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, min, max) => isNum(v) && v >= min && v <= max;

const SEX = ['w', 'm'];
const ACTIVITY = ['sitzend', 'leicht', 'aktiv', 'sehr-aktiv'];
const GOALS = ['abnehmen', 'halten', 'aufbauen'];
const STYLES = ['ausgewogen', 'low-carb', 'keto', 'primal', 'carnivore'];
const SOURCES = ['db', 'ai', 'manual'];

export function validateProfile(p) {
  if (!isObj(p)) throw bad('Profil fehlt oder ist ungültig.');
  if (!SEX.includes(p.sex)) throw bad('Geschlecht ist ungültig.');
  if (!(inRange(p.age, 10, 100) && Number.isInteger(p.age))) throw bad('Alter muss zwischen 10 und 100 Jahren liegen.');
  if (!inRange(p.heightCm, 120, 230)) throw bad('Größe muss zwischen 120 und 230 cm liegen.');
  if (!inRange(p.weightKg, 30, 300)) throw bad('Gewicht muss zwischen 30 und 300 kg liegen.');
  if (!ACTIVITY.includes(p.activity)) throw bad('Aktivitätslevel ist ungültig.');
  if (!GOALS.includes(p.goal)) throw bad('Ziel ist ungültig.');
  if (!STYLES.includes(p.style)) throw bad('Ernährungsstil ist ungültig.');
  if (![2, 3, 4].includes(p.meals)) throw bad('Mahlzeiten pro Tag müssen 2, 3 oder 4 sein.');
  const gw = p.goalWeightKg ?? null;
  if (gw !== null && !inRange(gw, 30, 300)) throw bad('Zielgewicht muss zwischen 30 und 300 kg liegen.');
  return {
    sex: p.sex, age: p.age, heightCm: p.heightCm, weightKg: p.weightKg, activity: p.activity,
    goal: p.goal, style: p.style, meals: p.meals, goalWeightKg: gw,
  };
}

export function validateDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Datum muss im Format JJJJ-MM-TT angegeben werden.');
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw bad('Das Datum existiert nicht.');
  return date;
}

export function validateKg(kg) {
  if (!inRange(kg, 30, 300)) throw bad('Gewicht muss zwischen 30 und 300 kg liegen.');
  return kg;
}

function validateIngredient(ing, i) {
  const where = `Zutat ${i + 1}`;
  if (!isObj(ing)) throw bad(`${where} ist ungültig.`);
  if (typeof ing.name !== 'string' || !ing.name.trim() || ing.name.length > 120) throw bad(`${where}: Name fehlt oder ist zu lang.`);
  if (!(isNum(ing.grams) && ing.grams > 0 && ing.grams <= 5000)) throw bad(`${where}: Menge muss über 0 und höchstens 5000 g liegen.`);
  if (!SOURCES.includes(ing.source)) throw bad(`${where}: Quelle ist ungültig.`);
  const foodId = ing.foodId ?? null;
  if (foodId !== null && (typeof foodId !== 'string' || foodId.length > 80)) throw bad(`${where}: Lebensmittel-ID ist ungültig.`);
  if (!isObj(ing.per100)) throw bad(`${where}: Nährwerte fehlen.`);
  const per100 = {};
  for (const k of ['kcal', 'protein', 'fat', 'carbs', 'fiber']) {
    const v = ing.per100[k];
    if (!(isNum(v) && v >= 0 && v <= 10000)) throw bad(`${where}: Nährwert „${k}“ ist ungültig.`);
    per100[k] = v;
  }
  const note = ing.note ?? '';
  if (typeof note !== 'string' || note.length > 300) throw bad(`${where}: Hinweis ist ungültig.`);
  return { name: ing.name.trim(), grams: ing.grams, foodId, per100, source: ing.source, note };
}

export function validateRecipeInput(b) {
  if (!isObj(b)) throw bad('Rezept fehlt oder ist ungültig.');
  if (typeof b.name !== 'string' || b.name.trim().length < 1 || b.name.trim().length > 120) throw bad('Der Rezeptname muss 1 bis 120 Zeichen lang sein.');
  if (!(inRange(b.portions, 1, 50) && Number.isInteger(b.portions))) throw bad('Portionen müssen zwischen 1 und 50 liegen.');
  if (!Array.isArray(b.ingredients) || b.ingredients.length > 100) throw bad('Zutaten müssen eine Liste mit höchstens 100 Einträgen sein.');
  return { name: b.name.trim(), portions: b.portions, ingredients: b.ingredients.map(validateIngredient) };
}

export function validateShopping(s) {
  if (!isObj(s)) throw bad('Einkaufsliste fehlt oder ist ungültig.');
  if (!Array.isArray(s.selections) || s.selections.length > 200) throw bad('Auswahl ist ungültig.');
  const selections = s.selections.map((x) => {
    if (!isObj(x) || typeof x.recipeId !== 'string' || !x.recipeId || x.recipeId.length > 80
      || !(isNum(x.portions) && x.portions > 0 && x.portions <= 500)) throw bad('Eine Rezeptauswahl ist ungültig.');
    return { recipeId: x.recipeId, portions: x.portions };
  });
  if (!Array.isArray(s.manual) || s.manual.length > 200) throw bad('Es sind höchstens 200 eigene Einträge erlaubt.');
  const manual = s.manual.map((x) => {
    if (!isObj(x) || typeof x.id !== 'string' || !x.id || x.id.length > 80) throw bad('Ein eigener Eintrag ist ungültig.');
    if (typeof x.text !== 'string' || !x.text.trim() || x.text.length > 200) throw bad('Ein eigener Eintrag muss 1 bis 200 Zeichen lang sein.');
    if (typeof x.checked !== 'boolean') throw bad('Ein eigener Eintrag ist ungültig.');
    return { id: x.id, text: x.text.trim(), checked: x.checked };
  });
  if (!isObj(s.checked)) throw bad('Abgehakte Einträge sind ungültig.');
  const entries = Object.entries(s.checked);
  if (entries.length > 1000) throw bad('Zu viele abgehakte Einträge.');
  const checked = Object.fromEntries(entries.filter(([k, v]) => v === true && k.length <= 200));
  return { selections, manual, checked };
}

function validateSettings(s) {
  if (!isObj(s)) throw bad('Einstellungen fehlen oder sind ungültig.');
  const labels = {
    geminiKey: 'Gemini-Key', openrouterKey: 'OpenRouter-Key',
    geminiModel: 'Gemini-Modell', openrouterModel: 'OpenRouter-Modell',
  };
  const out = {};
  for (const [k, label] of Object.entries(labels)) {
    const v = s[k] ?? '';
    if (typeof v !== 'string') throw bad(`${label} ist ungültig.`);
    const t = v.trim();
    if (t.length > 300) throw bad(`${label} ist zu lang (höchstens 300 Zeichen).`);
    out[k] = t;
  }
  out.geminiModel ||= DEFAULT_GEMINI_MODEL;
  out.openrouterModel ||= DEFAULT_OPENROUTER_MODEL;
  return out;
}

const byDate = (x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0);

// ---------- Store ----------

export function createStore(storage = globalThis.localStorage) {
  function readRaw(key) {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  function write(key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {
      throw new Error(WRITE_ERROR);
    }
  }

  function load() {
    const raw = readRaw(STATE_KEY);
    if (raw === null || raw === undefined) return emptyState();
    try {
      const parsed = JSON.parse(raw);
      if (!isObj(parsed)) throw new Error('Form');
      const base = emptyState();
      const state = {
        profile: isObj(parsed.profile) ? parsed.profile : null,
        weights: Array.isArray(parsed.weights) ? parsed.weights : base.weights,
        recipes: Array.isArray(parsed.recipes) ? parsed.recipes : base.recipes,
        shopping: { ...base.shopping, ...(isObj(parsed.shopping) ? parsed.shopping : {}) },
      };
      return state;
    } catch {
      try { storage.setItem(BROKEN_KEY, String(raw)); } catch { /* ignorieren */ }
      return emptyState();
    }
  }

  // Lesen-Ändern-Schreiben: fn bekommt eine Kopie; wirft fn, bleibt der Speicher unverändert.
  function update(fn) {
    const draft = load();
    const result = fn(draft);
    write(STATE_KEY, draft);
    return structuredClone(result);
  }

  function getState() {
    return structuredClone(load());
  }

  function saveProfile(p) {
    const profile = validateProfile(p);
    return update((s) => { s.profile = profile; return profile; });
  }

  function setWeight(date, kg) {
    const d = validateDate(date);
    const v = validateKg(kg);
    return update((s) => {
      s.weights = s.weights.filter((w) => w.date !== d);
      s.weights.push({ date: d, kg: v });
      s.weights.sort(byDate);
      return s.weights;
    });
  }

  function deleteWeight(date) {
    const d = validateDate(date);
    return update((s) => {
      s.weights = s.weights.filter((w) => w.date !== d);
      s.weights.sort(byDate);
      return s.weights;
    });
  }

  function createRecipe(r) {
    const input = validateRecipeInput(r);
    const recipe = { id: globalThis.crypto.randomUUID(), ...input, createdAt: new Date().toISOString() };
    return update((s) => { s.recipes.push(recipe); return recipe; });
  }

  function updateRecipe(id, r) {
    const input = validateRecipeInput(r);
    return update((s) => {
      const i = s.recipes.findIndex((x) => x.id === id);
      if (i < 0) throw new Error('Rezept nicht gefunden.');
      s.recipes[i] = { ...s.recipes[i], ...input };
      return s.recipes[i];
    });
  }

  function deleteRecipe(id) {
    return update((s) => {
      const i = s.recipes.findIndex((x) => x.id === id);
      if (i < 0) throw new Error('Rezept nicht gefunden.');
      s.recipes.splice(i, 1);
      return { ok: true };
    });
  }

  function saveShopping(sh) {
    const shopping = validateShopping(sh);
    return update((s) => { s.shopping = shopping; return shopping; });
  }

  function getSettings() {
    const raw = readRaw(SETTINGS_KEY);
    let parsed = {};
    if (raw) {
      try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    }
    try {
      return validateSettings(isObj(parsed) ? parsed : {});
    } catch {
      return validateSettings({});
    }
  }

  function saveSettings(s) {
    const settings = validateSettings(s);
    write(SETTINGS_KEY, settings);
    return structuredClone(settings);
  }

  function exportData() {
    return { app: 'makrokueche', version: 1, exportedAt: new Date().toISOString(), state: getState() };
  }

  function importData(obj) {
    if (!isObj(obj) || obj.app !== 'makrokueche' || obj.version !== 1) throw bad('Das ist keine Makroküche-Sicherung.');
    const st = obj.state;
    if (!isObj(st)) throw bad('Die Sicherung enthält keinen gültigen Zustand.');
    // Erst alles prüfen, dann ersetzen.
    const profile = st.profile === null || st.profile === undefined ? null : validateProfile(st.profile);
    if (!Array.isArray(st.weights)) throw bad('Die Gewichtsliste in der Sicherung ist ungültig.');
    const byDay = new Map();
    for (const w of st.weights) {
      if (!isObj(w)) throw bad('Ein Gewichtseintrag in der Sicherung ist ungültig.');
      const date = validateDate(w.date);
      byDay.set(date, { date, kg: validateKg(w.kg) });
    }
    const weights = [...byDay.values()].sort(byDate);
    if (!Array.isArray(st.recipes)) throw bad('Die Rezeptliste in der Sicherung ist ungültig.');
    const recipes = st.recipes.map((r) => {
      const input = validateRecipeInput(r);
      const id = typeof r.id === 'string' && r.id && r.id.length <= 80 ? r.id : globalThis.crypto.randomUUID();
      const createdAt = typeof r.createdAt === 'string' && r.createdAt ? r.createdAt : new Date().toISOString();
      return { id, ...input, createdAt };
    });
    const shopping = validateShopping(st.shopping ?? emptyState().shopping);
    const next = { profile, weights, recipes, shopping };
    write(STATE_KEY, next);
    return structuredClone(next);
  }

  return {
    getState, saveProfile, setWeight, deleteWeight, createRecipe, updateRecipe, deleteRecipe,
    saveShopping, getSettings, saveSettings, exportData, importData,
  };
}
