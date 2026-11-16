import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredients } from '../public/js/ai.js';
import { createApi } from '../public/js/api.js';
import { createStore } from '../public/js/store.js';

const KEY_G = 'GEMINI-GEHEIM-12345';
const KEY_O = 'OPENROUTER-GEHEIM-67890';
const ENV = { GEMINI_API_KEY: KEY_G, OPENROUTER_API_KEY: KEY_O };

const FOODS = [
  { id: 'rinderhack', name: 'Rinderhackfleisch', aliases: ['Rinderhack'], category: 'fleisch', per100: { kcal: 250, protein: 18, fat: 20, carbs: 0, fiber: 0 } },
  { id: 'butter', name: 'Butter', aliases: [], category: 'fette-oele', per100: { kcal: 740, protein: 0.7, fat: 82, carbs: 0.6, fiber: 0 } },
];

const geminiOk = (items) => ({
  ok: true, status: 200,
  json: async () => ({ steps: [{ type: 'user_input' }, { type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ items }) }] }] }),
});
const orOk = (items) => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify({ items }) } }] }),
});
const item = (o) => ({ name: 'Butter', grams: 10, foodId: 'butter', kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, ...o });

function makeFetch(handlers) {
  const calls = [];
  const fn = async (url, init) => {
    const entry = { url: String(url), init, body: init?.body ? String(init.body) : '' };
    calls.push(entry);
    const h = String(url).includes('generativelanguage') ? handlers.gemini : handlers.openrouter;
    if (!h) throw new Error('unerwarteter Aufruf');
    return h(entry);
  };
  fn.calls = calls;
  return fn;
}

const run = (text, fetchImpl, env = ENV) => parseIngredients(text, { env, fetchImpl, foods: FOODS });

// Kein echtes Netz: Standard-fetchImpl in Tests immer ersetzen.
const noNet = async () => { throw new Error('Netzwerk gesperrt im Test'); };

test('KI (a): Gemini liefert gültige Antwort, DB-Werte bei gültiger foodId; Key geht nur im Header raus', async () => {
  const fetchImpl = makeFetch({
    gemini: () => geminiOk([item({ grams: 20, kcal: 1, protein: 1, fat: 1, carbs: 1, fiber: 1 })]),
  });
  const r = await run('20 g Butter', fetchImpl);
  assert.equal(r.provider, 'gemini');
  assert.equal(r.ingredients.length, 1);
  assert.equal(r.ingredients[0].source, 'db');
  assert.equal(r.ingredients[0].foodId, 'butter');
  assert.deepEqual(r.ingredients[0].per100, FOODS[1].per100);
  assert.equal(r.ingredients[0].grams, 20);

  assert.equal(fetchImpl.calls.length, 1);
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(call.init.headers['x-goog-api-key'], KEY_G);
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  const headerNames = Object.keys(call.init.headers).map((h) => h.toLowerCase());
  assert.ok(!headerNames.includes('api-revision'), 'Api-Revision darf nicht gesendet werden');
  assert.deepEqual(headerNames.sort(), ['content-type', 'x-goog-api-key']);
  const body = JSON.parse(call.body);
  assert.equal(body.model, 'gemini-3.8-flash');
  assert.equal(body.response_format.mime_type, 'application/json');
  assert.match(body.input, /rinderhack\|Rinderhackfleisch/);
  assert.match(body.input, /20 g Butter/);
  assert.ok(!call.body.includes(KEY_G) && !call.body.includes(KEY_O));
  assert.ok(!JSON.stringify(r).includes(KEY_G) && !JSON.stringify(r).includes(KEY_O));
});

test('KI (b): Gemini scheitert, OpenRouter antwortet mit JSON im Zaun', async () => {
  const items = [item({ name: 'Rinderhack', grams: 200, foodId: 'rinderhack' })];
  const fetchImpl = makeFetch({
    gemini: () => { throw new Error(`kaputt ${KEY_G}`); },
    openrouter: () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: 'Hier das Ergebnis:\n```json\n' + JSON.stringify({ items }) + '\n```' } }] }),
    }),
  });
  const r = await run('200 g Rinderhack', fetchImpl);
  assert.equal(r.provider, 'openrouter');
  assert.equal(r.ingredients[0].foodId, 'rinderhack');
  assert.ok(r.warnings.some((w) => /Gemini nicht erreichbar, OpenRouter verwendet/.test(w)), JSON.stringify(r.warnings));
  const orCall = fetchImpl.calls[1];
  assert.equal(orCall.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(orCall.init.headers.Authorization, `Bearer ${KEY_O}`);
  const orBody = JSON.parse(orCall.body);
  assert.equal(orBody.model, 'openrouter/free');
  assert.equal(orBody.response_format.type, 'json_schema');
  assert.ok(!JSON.stringify(r).includes(KEY_G) && !JSON.stringify(r).includes(KEY_O));
});

test('KI (b2): Gemini antwortet mit HTTP 500 → OpenRouter', async () => {
  const fetchImpl = makeFetch({
    gemini: () => ({ ok: false, status: 500, json: async () => ({}) }),
    openrouter: () => orOk([item()]),
  });
  const r = await run('Butter', fetchImpl);
  assert.equal(r.provider, 'openrouter');
});

test('KI (c): beide scheitern oder keine Keys → lokaler Parser', async () => {
  const fail = makeFetch({ gemini: () => { throw new Error('x'); }, openrouter: () => ({ ok: false, status: 429, json: async () => ({}) }) });
  const r = await run('20 g Butter', fail);
  assert.equal(r.provider, 'lokal');
  assert.ok(r.warnings.length >= 1);
  assert.match(r.warnings[0], /Gemini und OpenRouter nicht erreichbar/);
  assert.ok(Array.isArray(r.ingredients));
  assert.ok(!JSON.stringify(r).includes(KEY_G) && !JSON.stringify(r).includes(KEY_O));

  const r2 = await run('20 g Butter', noNet, {});
  assert.equal(r2.provider, 'lokal');
  assert.ok(r2.warnings.length >= 1);
  assert.equal(r2.ingredients[0]?.foodId, 'butter');
});

test('KI (d): unstimmige KI-Schätzung wird korrigiert und warnt; ungültige Menge verworfen', async () => {
  const fetchImpl = makeFetch({
    gemini: () => geminiOk([
      { name: 'Zauberpulver', grams: 30, foodId: '', kcal: 500, protein: 10, fat: 0, carbs: 10, fiber: 0 },
      { name: 'Riesenmenge', grams: 99999, foodId: 'butter', kcal: 1, protein: 1, fat: 1, carbs: 1, fiber: 1 },
      { name: 'Erfundene Id', grams: 50, foodId: 'gibt-es-nicht', kcal: 100, protein: 5, fat: 5, carbs: 10, fiber: 0 },
    ]),
  });
  const r = await run('Zauberpulver', fetchImpl, { GEMINI_API_KEY: KEY_G });
  assert.equal(r.provider, 'gemini');
  const pulver = r.ingredients.find((i) => i.name === 'Zauberpulver');
  assert.equal(pulver.source, 'ai');
  assert.equal(pulver.foodId, null);
  assert.equal(pulver.per100.kcal, 80); // 4*10 + 4*10
  assert.match(pulver.note, /korrigiert/);
  assert.ok(r.warnings.some((w) => w.includes('Zauberpulver')));
  assert.ok(!r.ingredients.some((i) => i.name === 'Riesenmenge'));
  assert.ok(r.warnings.some((w) => w.includes('Riesenmenge')));
  const erfunden = r.ingredients.find((i) => i.name === 'Erfundene Id');
  assert.equal(erfunden.source, 'ai');
  assert.deepEqual(erfunden.per100, { kcal: 100, protein: 5, fat: 5, carbs: 10, fiber: 0 });
});

test('KI (e): nur Zutatentext und Liste gehen raus, keine Profildaten', async () => {
  const fetchImpl = makeFetch({ gemini: () => geminiOk([item()]) });
  await run('20 g Butter', fetchImpl);
  const body = fetchImpl.calls[0].body;
  for (const needle of ['83.7', '"age"', 'heightCm', 'weightKg', 'goalWeightKg', 'keto', KEY_G, KEY_O]) {
    assert.ok(!body.includes(needle), `Body enthält ${needle}`);
  }
});

test('Gemini-Antwort: output_text wird gelesen', async () => {
  const fetchImpl = makeFetch({
    gemini: () => ({ ok: true, status: 200, json: async () => ({ output_text: JSON.stringify({ items: [item({ grams: 15 })] }) }) }),
  });
  const r = await run('Butter', fetchImpl, { GEMINI_API_KEY: KEY_G });
  assert.equal(r.provider, 'gemini');
  assert.equal(r.ingredients[0].grams, 15);
});

test('Gemini-Antwort: outputs[] wird gelesen, letzter model_output gewinnt, mehrere Textteile werden verkettet', async () => {
  const outputs = makeFetch({
    gemini: () => ({ ok: true, status: 200, json: async () => ({ outputs: [{ text: JSON.stringify({ items: [item({ grams: 12 })] }) }] }) }),
  });
  assert.equal((await run('Butter', outputs, { GEMINI_API_KEY: KEY_G })).ingredients[0].grams, 12);

  const json = JSON.stringify({ items: [item({ grams: 33 })] });
  const cut = Math.floor(json.length / 2);
  const steps = makeFetch({
    gemini: () => ({
      ok: true, status: 200,
      json: async () => ({
        steps: [
          { type: 'model_output', content: [{ type: 'text', text: '{"items":[]}' }] },
          { type: 'model_output', content: [{ type: 'text', text: json.slice(0, cut) }, { type: 'text', text: json.slice(cut) }] },
        ],
      }),
    }),
  });
  assert.equal((await run('Butter', steps, { GEMINI_API_KEY: KEY_G })).ingredients[0].grams, 33);

  const leer = makeFetch({ gemini: () => ({ ok: true, status: 200, json: async () => ({}) }) });
  assert.equal((await run('Butter', leer, { GEMINI_API_KEY: KEY_G })).provider, 'lokal');
});

test('Zahlen als Text ("200", "12,5") werden akzeptiert', async () => {
  const fetchImpl = makeFetch({
    gemini: () => geminiOk([
      { name: 'Rinderhack', grams: '200', foodId: 'rinderhack', kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 },
      { name: 'Mysterium', grams: '12,5', foodId: '', kcal: '100', protein: '5,5', fat: '4', carbs: '10', fiber: '0' },
    ]),
  });
  const r = await run('Rinderhack und Mysterium', fetchImpl, { GEMINI_API_KEY: KEY_G });
  assert.equal(r.provider, 'gemini');
  assert.equal(r.ingredients[0].grams, 200);
  const m = r.ingredients[1];
  assert.equal(m.grams, 12.5);
  assert.equal(m.source, 'ai');
  assert.equal(m.per100.protein, 5.5);
  assert.equal(m.per100.carbs, 10);
});

test('Key taucht weder in Rückgabe noch in Warnungen auf, auch bei Fehlern', async () => {
  const logs = [];
  const orig = console.warn;
  console.warn = (...a) => logs.push(a.join(' '));
  try {
    const fetchImpl = makeFetch({
      gemini: () => { throw new Error(`Netz kaputt ${KEY_G}`); },
      openrouter: () => ({ ok: false, status: 401, json: async () => ({ error: KEY_O }) }),
    });
    const r = await run('20 g Butter', fetchImpl);
    const all = JSON.stringify(r) + logs.join('\n');
    assert.ok(!all.includes(KEY_G) && !all.includes(KEY_O));
    assert.equal(logs.length, 2);
  } finally {
    console.warn = orig;
  }
});

// ---------- api.js: Eingabeprüfung, Rate-Limit, Settings-Anbindung ----------

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

test('api.parseIngredients: Eingabe prüfen, Keys aus den Einstellungen, Rate-Limit', async () => {
  const store = createStore(memStorage());
  const fetchImpl = makeFetch({ gemini: () => geminiOk([item()]) });
  const api = createApi({ store, fetchImpl, foods: FOODS });

  assert.deepEqual(await api.health(), { ok: true, ai: { gemini: false, openrouter: false } });
  await assert.rejects(api.parseIngredients(''), /1 bis 2000 Zeichen/);
  await assert.rejects(api.parseIngredients('   '), /1 bis 2000 Zeichen/);
  await assert.rejects(api.parseIngredients('a'.repeat(2001)), /1 bis 2000 Zeichen/);
  await assert.rejects(api.parseIngredients(5), /1 bis 2000 Zeichen/);

  // ohne Key: lokaler Parser, kein Netz
  assert.equal((await api.parseIngredients('Butter')).provider, 'lokal');
  assert.equal(fetchImpl.calls.length, 0);

  await api.saveSettings({ geminiKey: KEY_G, geminiModel: 'mein-modell' });
  assert.deepEqual(await api.health(), { ok: true, ai: { gemini: true, openrouter: false } });
  const r = await api.parseIngredients('Butter');
  assert.equal(r.provider, 'gemini');
  assert.equal(JSON.parse(fetchImpl.calls[0].body).model, 'mein-modell');

  let last;
  let error = null;
  for (let i = 0; i < 25; i++) {
    try { last = await api.parseIngredients('Butter'); } catch (e) { error = e; break; }
  }
  assert.ok(last);
  assert.equal(error?.message, 'Zu viele KI-Anfragen. Bitte kurz warten.');
});

test('api: Daten-Methoden reichen an den Store durch, Export ohne Keys', async () => {
  const api = createApi({ store: createStore(memStorage()), fetchImpl: noNet, foods: FOODS });
  await api.saveSettings({ geminiKey: KEY_G });
  await api.setWeight('2026-03-01', 80);
  const ex = await api.exportData();
  assert.deepEqual(ex.state.weights, [{ date: '2026-03-01', kg: 80 }]);
  assert.ok(!JSON.stringify(ex).includes(KEY_G));
  assert.equal((await api.getSettings()).geminiKey, KEY_G);
  const st = await api.importData(ex);
  assert.deepEqual(st.weights, [{ date: '2026-03-01', kg: 80 }]);
});

test('api: Foods werden einmalig geladen (Array oder { foods })', async () => {
  const orig = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (u) => {
    count++;
    assert.match(String(u), /data\/foods\.json$/);
    return { ok: true, json: async () => ({ foods: FOODS }) };
  };
  try {
    const api = createApi({ store: createStore(memStorage()) });
    const r1 = await api.parseIngredients('20 g Butter');
    await api.parseIngredients('Butter');
    assert.equal(count, 1);
    assert.equal(r1.provider, 'lokal');
    assert.equal(r1.ingredients[0].foodId, 'butter');
  } finally {
    globalThis.fetch = orig;
  }
});
