// Lokale "API": Daten im Browser-Speicher (store.js), KI direkt aus dem Browser (ai.js).
// Gleiche Methoden wie früher der fetch-Wrapper, alle async.
import { createStore } from './store.js';
import { parseIngredients as runParse } from './ai.js';

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export function createApi({ store, fetchImpl, foods } = {}) {
  let theStore = store || null;
  let foodsCache = foods || null;
  const hits = [];
  const getStore = () => (theStore ||= createStore());

  async function getFoods() {
    if (foodsCache) return foodsCache;
    let data;
    try {
      const res = await globalThis.fetch(new URL('../data/foods.json', import.meta.url));
      if (!res.ok) throw new Error('Status');
      data = await res.json();
    } catch {
      throw new Error('Die Lebensmitteltabelle konnte nicht geladen werden.');
    }
    const list = Array.isArray(data) ? data : data?.foods;
    if (!Array.isArray(list)) throw new Error('Die Lebensmitteltabelle konnte nicht geladen werden.');
    foodsCache = list;
    return list;
  }

  function rateLimited() {
    const now = Date.now();
    while (hits.length && now - hits[0] > RATE_WINDOW_MS) hits.shift();
    if (hits.length >= RATE_LIMIT) return true;
    hits.push(now);
    return false;
  }

  return {
    async health() {
      const s = getStore().getSettings();
      return { ok: true, ai: { gemini: Boolean(s.geminiKey), openrouter: Boolean(s.openrouterKey) } };
    },
    async getState() { return getStore().getState(); },
    async saveProfile(p) { return getStore().saveProfile(p); },
    async setWeight(date, kg) { return getStore().setWeight(date, kg); },
    async deleteWeight(date) { return getStore().deleteWeight(date); },
    async createRecipe(r) { return getStore().createRecipe(r); },
    async updateRecipe(id, r) { return getStore().updateRecipe(id, r); },
    async deleteRecipe(id) { return getStore().deleteRecipe(id); },
    async saveShopping(s) { return getStore().saveShopping(s); },
    async getSettings() { return getStore().getSettings(); },
    async saveSettings(s) { return getStore().saveSettings(s); },
    async exportData() { return getStore().exportData(); },
    async importData(obj) { return getStore().importData(obj); },
    async parseIngredients(text) {
      const t = typeof text === 'string' ? text.trim() : '';
      if (t.length < 1 || t.length > 2000) throw new Error('Der Text muss 1 bis 2000 Zeichen lang sein.');
      if (rateLimited()) throw new Error('Zu viele KI-Anfragen. Bitte kurz warten.');
      const s = getStore().getSettings();
      const env = {
        GEMINI_API_KEY: s.geminiKey,
        OPENROUTER_API_KEY: s.openrouterKey,
        GEMINI_MODEL: s.geminiModel,
        OPENROUTER_MODEL: s.openrouterModel,
      };
      const opts = { env, foods: await getFoods() };
      if (fetchImpl) opts.fetchImpl = fetchImpl;
      return runParse(t, opts);
    },
  };
}

export const api = createApi();
