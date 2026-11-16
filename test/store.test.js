import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../public/js/store.js';

const STATE_KEY = 'makrokueche.state.v1';
const SETTINGS_KEY = 'makrokueche.settings.v1';

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

const PROFILE = { sex: 'w', age: 47, heightCm: 171, weightKg: 83.7, activity: 'leicht', goal: 'abnehmen', style: 'keto', meals: 3, goalWeightKg: 70 };
const PER100 = { kcal: 740, protein: 0.7, fat: 82, carbs: 0.6, fiber: 0 };
const INGREDIENT = { name: 'Butter', grams: 20, foodId: 'butter', per100: PER100, source: 'db', note: '' };
const RECIPE = { name: 'Butterfleisch', portions: 2, ingredients: [INGREDIENT] };
const EMPTY = { profile: null, weights: [], recipes: [], shopping: { selections: [], manual: [], checked: {} } };

test('Startzustand ist leer', () => {
  assert.deepEqual(createStore(fakeStorage()).getState(), EMPTY);
});

test('fehlende Teile im Speicher werden aufgefüllt', () => {
  const st = fakeStorage({ [STATE_KEY]: JSON.stringify({ profile: PROFILE }) });
  assert.deepEqual(createStore(st).getState(), { ...EMPTY, profile: PROFILE });
});

test('Profil speichern, wiederfinden, ungültig wirft', () => {
  const st = fakeStorage();
  const s = createStore(st);
  assert.deepEqual(s.saveProfile(PROFILE), PROFILE);
  assert.deepEqual(s.getState().profile, PROFILE);
  assert.deepEqual(JSON.parse(st.getItem(STATE_KEY)).profile, PROFILE);
  for (const patch of [{ age: 9 }, { heightCm: 300 }, { weightKg: 20 }, { meals: 5 }, { style: 'vegan' }, { sex: 'x' }, { goalWeightKg: 5 }]) {
    assert.throws(() => s.saveProfile({ ...PROFILE, ...patch }), (e) => e instanceof Error && e.message.length > 0, JSON.stringify(patch));
  }
  assert.throws(() => s.saveProfile({ ...PROFILE, age: 9 }), /Alter muss zwischen 10 und 100/);
  assert.equal(s.saveProfile({ ...PROFILE, goalWeightKg: null }).goalWeightKg, null);
  assert.deepEqual(s.getState().profile.goalWeightKg, null);
});

test('Gewichte: anlegen, überschreiben, löschen, sortiert', () => {
  const s = createStore(fakeStorage());
  s.setWeight('2026-03-02', 80);
  s.setWeight('2026-03-01', 81);
  let r = s.setWeight('2026-03-03', 79.5);
  assert.deepEqual(r.map((w) => w.date), ['2026-03-01', '2026-03-02', '2026-03-03']);
  r = s.setWeight('2026-03-02', 80.4);
  assert.equal(r.length, 3);
  assert.equal(r[1].kg, 80.4);
  r = s.deleteWeight('2026-03-01');
  assert.deepEqual(r, [{ date: '2026-03-02', kg: 80.4 }, { date: '2026-03-03', kg: 79.5 }]);
  assert.throws(() => s.setWeight('2026-02-30', 80), /existiert nicht/);
  assert.throws(() => s.setWeight('morgen', 80), /Format/);
  assert.throws(() => s.setWeight('2026-03-04', 500), /zwischen 30 und 300/);
  assert.throws(() => s.setWeight('2026-03-04', '80'), /zwischen 30 und 300/);
  assert.equal(s.getState().weights.length, 2);
});

test('Rezepte: anlegen, ändern, löschen, nicht gefunden', () => {
  const s = createStore(fakeStorage());
  const created = s.createRecipe(RECIPE);
  assert.match(created.id, /^[0-9a-f-]{36}$/);
  assert.ok(!Number.isNaN(Date.parse(created.createdAt)));
  const upd = s.updateRecipe(created.id, { ...RECIPE, name: 'Neuer Name', portions: 4 });
  assert.equal(upd.id, created.id);
  assert.equal(upd.createdAt, created.createdAt);
  assert.equal(upd.name, 'Neuer Name');
  assert.equal(s.getState().recipes[0].portions, 4);

  assert.throws(() => s.updateRecipe('gibtsnicht', RECIPE), /Rezept nicht gefunden\./);
  assert.throws(() => s.deleteRecipe('gibtsnicht'), /Rezept nicht gefunden\./);

  assert.throws(() => s.createRecipe({ ...RECIPE, name: '' }), /Rezeptname/);
  assert.throws(() => s.createRecipe({ ...RECIPE, portions: 0 }), /Portionen/);
  assert.throws(() => s.createRecipe({ ...RECIPE, ingredients: [{ ...INGREDIENT, grams: 0 }] }), /Menge/);
  assert.throws(() => s.createRecipe({ ...RECIPE, ingredients: [{ ...INGREDIENT, source: 'x' }] }), /Quelle/);
  assert.throws(() => s.createRecipe({ ...RECIPE, ingredients: [{ ...INGREDIENT, per100: { ...PER100, fat: -1 } }] }), /Nährwert/);
  assert.equal(s.getState().recipes.length, 1);

  assert.deepEqual(s.deleteRecipe(created.id), { ok: true });
  assert.deepEqual(s.getState().recipes, []);
});

test('Einkaufsliste speichern und validieren', () => {
  const s = createStore(fakeStorage());
  const shopping = {
    selections: [{ recipeId: 'abc', portions: 3 }],
    manual: [{ id: 'm1', text: 'Kaffee', checked: true }],
    checked: { butter: true },
  };
  assert.deepEqual(s.saveShopping(shopping), shopping);
  assert.deepEqual(s.getState().shopping, shopping);
  assert.throws(() => s.saveShopping({ ...shopping, manual: [{ id: 'm', text: 'x'.repeat(201), checked: false }] }), /1 bis 200 Zeichen/);
  const viele = Array.from({ length: 201 }, (_, i) => ({ id: `m${i}`, text: 'a', checked: false }));
  assert.throws(() => s.saveShopping({ ...shopping, manual: viele }), /höchstens 200/);
  assert.deepEqual(s.getState().shopping, shopping);
});

test('Settings: Standardmodelle, Trimmen, Längenlimit', () => {
  const st = fakeStorage();
  const s = createStore(st);
  assert.deepEqual(s.getSettings(), { geminiKey: '', openrouterKey: '', geminiModel: 'gemini-3.8-flash', openrouterModel: 'openrouter/free' });
  const saved = s.saveSettings({ geminiKey: '  abc  ', openrouterKey: ' def ', geminiModel: '   ', openrouterModel: ' my/model ' });
  assert.deepEqual(saved, { geminiKey: 'abc', openrouterKey: 'def', geminiModel: 'gemini-3.8-flash', openrouterModel: 'my/model' });
  assert.deepEqual(s.getSettings(), saved);
  assert.throws(() => s.saveSettings({ ...saved, geminiKey: 'k'.repeat(301) }), /zu lang/);
  assert.throws(() => s.saveSettings({ ...saved, geminiModel: 5 }), /ungültig/);
  assert.equal(s.saveSettings({ ...saved, geminiKey: 'k'.repeat(300) }).geminiKey.length, 300);
  // teilweise gespeicherte Settings liefern trotzdem alle vier Felder
  st.setItem(SETTINGS_KEY, JSON.stringify({ geminiKey: 'x' }));
  assert.deepEqual(Object.keys(s.getSettings()).sort(), ['geminiKey', 'geminiModel', 'openrouterKey', 'openrouterModel']);
});

test('Export enthält keine Keys', () => {
  const s = createStore(fakeStorage());
  s.saveProfile(PROFILE);
  s.saveSettings({ geminiKey: 'GEHEIM-G', openrouterKey: 'GEHEIM-O' });
  const ex = s.exportData();
  assert.equal(ex.app, 'makrokueche');
  assert.equal(ex.version, 1);
  assert.ok(!Number.isNaN(Date.parse(ex.exportedAt)));
  assert.deepEqual(ex.state.profile, PROFILE);
  const text = JSON.stringify(ex);
  assert.ok(!text.includes('GEHEIM'));
  assert.ok(!/geminiKey|openrouterKey/.test(text));
});

test('Import gültig ersetzt den State (Keys bleiben)', () => {
  const a = createStore(fakeStorage());
  a.saveProfile(PROFILE);
  a.setWeight('2026-03-02', 80);
  a.setWeight('2026-03-01', 81);
  const rec = a.createRecipe(RECIPE);
  const ex = a.exportData();

  const st = fakeStorage();
  const b = createStore(st);
  b.saveSettings({ geminiKey: 'meinkey' });
  b.createRecipe({ ...RECIPE, name: 'Alt' });
  const result = b.importData(JSON.parse(JSON.stringify(ex)));
  assert.deepEqual(result, a.getState());
  assert.deepEqual(b.getState(), a.getState());
  assert.equal(b.getState().recipes[0].id, rec.id);
  assert.equal(b.getState().recipes[0].createdAt, rec.createdAt);
  assert.deepEqual(b.getState().weights.map((w) => w.date), ['2026-03-01', '2026-03-02']);
  assert.equal(b.getSettings().geminiKey, 'meinkey');
});

test('Import: Rezept ohne id/createdAt bekommt neue Werte', () => {
  const s = createStore(fakeStorage());
  const r = s.importData({ app: 'makrokueche', version: 1, state: { profile: null, weights: [], recipes: [RECIPE], shopping: EMPTY.shopping } });
  assert.match(r.recipes[0].id, /^[0-9a-f-]{36}$/);
  assert.ok(!Number.isNaN(Date.parse(r.recipes[0].createdAt)));
});

test('Import mit falscher app oder version wird abgelehnt', () => {
  const s = createStore(fakeStorage());
  const state = EMPTY;
  for (const bad of [null, 'text', [], {}, { app: 'andere', version: 1, state }, { app: 'makrokueche', version: 2, state }, { app: 'makrokueche', state }]) {
    assert.throws(() => s.importData(bad), /keine Makroküche-Sicherung/);
  }
});

test('Import mit ungültigem Eintrag lässt den alten State unverändert', () => {
  const s = createStore(fakeStorage());
  s.saveProfile(PROFILE);
  s.createRecipe(RECIPE);
  const before = s.getState();
  const mk = (state) => ({ app: 'makrokueche', version: 1, state: { ...EMPTY, ...state } });
  const cases = [
    mk({ profile: { ...PROFILE, age: 5 } }),
    mk({ weights: [{ date: '2026-03-01', kg: 80 }, { date: '2026-13-01', kg: 80 }] }),
    mk({ weights: [{ date: '2026-03-01', kg: 5 }] }),
    mk({ recipes: [RECIPE, { ...RECIPE, name: '' }] }),
    mk({ shopping: { selections: [], manual: [{ id: 'x', text: '', checked: false }], checked: {} } }),
    { app: 'makrokueche', version: 1 },
  ];
  for (const c of cases) assert.throws(() => s.importData(c), Error);
  assert.deepEqual(s.getState(), before);
});

test('kaputtes JSON im Speicher: Rohtext gesichert, Startzustand', () => {
  const st = fakeStorage({ [STATE_KEY]: '{kaputt' });
  const s = createStore(st);
  assert.deepEqual(s.getState(), EMPTY);
  assert.equal(st.getItem('makrokueche.state.kaputt'), '{kaputt');
  // weiterarbeiten funktioniert
  s.saveProfile(PROFILE);
  assert.deepEqual(s.getState().profile, PROFILE);
});

test('Schreibfehler (Speicher voll/gesperrt) gibt deutsche Meldung, State bleibt', () => {
  const st = fakeStorage();
  const s = createStore(st);
  s.saveProfile(PROFILE);
  st.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => s.setWeight('2026-03-01', 80), /Speichern im Browser nicht möglich\. Ist der Speicher voll oder gesperrt\?/);
  assert.throws(() => s.saveSettings({}), /Speichern im Browser nicht möglich/);
  assert.deepEqual(s.getState().weights, []);
});

test('Rückgaben sind Kopien, keine Referenzen', () => {
  const s = createStore(fakeStorage());
  const profile = s.saveProfile(PROFILE);
  profile.age = 99;
  const state = s.getState();
  state.profile.age = 98;
  state.weights.push({ date: '2026-01-01', kg: 1 });
  assert.equal(s.getState().profile.age, 47);
  assert.deepEqual(s.getState().weights, []);
  const weights = s.setWeight('2026-03-01', 80);
  weights.length = 0;
  assert.equal(s.getState().weights.length, 1);
  const input = { ...RECIPE, ingredients: [{ ...INGREDIENT }] };
  const rec = s.createRecipe(input);
  rec.ingredients[0].grams = 1;
  input.ingredients[0].grams = 2;
  assert.equal(s.getState().recipes[0].ingredients[0].grams, 20);
  const settings = s.getSettings();
  settings.geminiKey = 'x';
  assert.equal(s.getSettings().geminiKey, '');
});
