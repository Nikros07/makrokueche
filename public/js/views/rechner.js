// Makro-Rechner: Zutaten erfassen (Freitext/KI, Tabelle, eigene), Werte je Portion, Rezept speichern.
import { h, fill, fmt, field, macroSummary, confirmDialog, emptyState } from '../ui.js';
import { ingredientMacros, sumMacros, perPortion, macroPercents, checkPer100, atwaterKcal } from '../core/macros.js';
import { searchFoods } from '../core/foodmatch.js';
import { styleFit } from '../core/targets.js';

const DRAFT_KEY = 'makrokueche.draft';
const KEYS = ['kcal', 'protein', 'fat', 'carbs', 'fiber'];

function emptyDraft() {
  return { recipeId: null, name: '', portions: 1, ingredients: [] };
}

function copyPer100(p) {
  const out = {};
  for (const k of KEYS) {
    const n = Number(p && p[k]);
    out[k] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return emptyDraft();
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || !Array.isArray(d.ingredients)) return emptyDraft();
    const portions = Number(d.portions);
    return {
      recipeId: typeof d.recipeId === 'string' ? d.recipeId : null,
      name: typeof d.name === 'string' ? d.name : '',
      portions: Number.isFinite(portions) && portions >= 1 ? Math.min(50, portions) : 1,
      ingredients: d.ingredients
        .filter((i) => i && typeof i === 'object')
        .map((i) => ({ ...i, per100: copyPer100(i.per100) })),
    };
  } catch {
    return emptyDraft();
  }
}

function saveDraft(draft) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* egal */ }
}

function clearDraftStorage() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* egal */ }
}

function parseNum(v) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function validGrams(g) {
  return Number.isFinite(g) && g > 0 && g <= 5000;
}

const PROVIDER_TEXT = {
  gemini: 'Erkannt mit Gemini',
  openrouter: 'Erkannt mit OpenRouter',
  lokal: 'Erkannt ohne KI (lokaler Parser)',
};

const BADGES = {
  db: ['badge badge-db', 'Tabelle'],
  ai: ['badge badge-ai', 'KI-Schätzung'],
  manual: ['badge badge-manual', 'Eigene'],
};

export async function render(root, ctx) {
  if (!document.querySelector('link[href="css/views/rechner.css"]')) {
    document.head.appendChild(h('link', { rel: 'stylesheet', href: 'css/views/rechner.css' }));
  }

  const draft = loadDraft();
  const persist = () => saveDraft(draft);
  const foods = Array.isArray(ctx.foods) ? ctx.foods : [];

  // ---------- Freitext ----------
  const textArea = h('textarea', {
    class: 'input', rows: 3, style: { minHeight: '96px', resize: 'vertical' },
    placeholder: '200 g Rinderhack, 2 Eier, 1 EL Butter, 1/2 Avocado',
    onkeydown: (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); recognize(); }
    },
  });
  const recognizeBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: recognize }, 'Zutaten erkennen');
  const parseInfo = h('div', { class: 'rc-stack-sm', 'aria-live': 'polite' });

  async function recognize() {
    const text = textArea.value.trim();
    if (!text || recognizeBtn.disabled) return;
    recognizeBtn.disabled = true;
    recognizeBtn.textContent = 'Erkenne …';
    try {
      const res = await ctx.api.parseIngredients(text);
      const found = Array.isArray(res && res.ingredients) ? res.ingredients : [];
      for (const ing of found) draft.ingredients.push({ ...ing, per100: copyPer100(ing.per100) });
      persist();
      textArea.value = '';
      const warnings = Array.isArray(res && res.warnings) ? res.warnings : [];
      fill(parseInfo, 
        h('div', { class: 'rc-small' }, PROVIDER_TEXT[res && res.provider] || 'Erkannt'),
        found.length === 0 ? h('div', { class: 'rc-small' }, 'Keine Zutat erkannt.') : null,
        warnings.length ? h('div', { class: 'hint' }, h('ul', null, ...warnings.map((w) => h('li', null, w)))) : null);
      renderList();
      updateSummary();
    } catch (err) {
      ctx.toast(err.message, 'error');
    } finally {
      recognizeBtn.disabled = false;
      recognizeBtn.textContent = 'Zutaten erkennen';
    }
  }

  // ---------- Tabelle: Suche ----------
  const listId = `rc-sug-${Math.random().toString(36).slice(2, 8)}`;
  const searchIn = h('input', {
    class: 'input', type: 'text', autocomplete: 'off', role: 'combobox', 'aria-autocomplete': 'list',
    'aria-expanded': 'false', 'aria-controls': listId,
    oninput: onSearchInput, onkeydown: onSearchKey, onblur: () => closeSuggest(),
  });
  const sugList = h('ul', {
    class: 'rc-suggest', id: listId, role: 'listbox', 'aria-label': 'Vorschläge', hidden: true,
    onmousedown: (ev) => ev.preventDefault(),
  });
  const gramsAddIn = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: 1, max: 5000, step: 'any', value: 100 });
  let chosen = null;
  let suggestions = [];
  let active = -1;

  function closeSuggest() {
    sugList.hidden = true;
    searchIn.setAttribute('aria-expanded', 'false');
    searchIn.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function setActive(i) {
    active = i;
    [...sugList.children].forEach((li, idx) => li.setAttribute('aria-selected', String(idx === i)));
    if (i >= 0 && sugList.children[i]) {
      searchIn.setAttribute('aria-activedescendant', sugList.children[i].id);
      sugList.children[i].scrollIntoView({ block: 'nearest' });
    } else {
      searchIn.removeAttribute('aria-activedescendant');
    }
  }

  function choose(food) {
    chosen = food;
    searchIn.value = food.name;
    const st = food.units && Number(food.units.stueck);
    gramsAddIn.value = st > 0 ? st : 100;
    closeSuggest();
    gramsAddIn.focus();
    gramsAddIn.select();
  }

  function onSearchInput() {
    chosen = null;
    const q = searchIn.value.trim();
    if (q.length < 2) { suggestions = []; closeSuggest(); return; }
    suggestions = searchFoods(q, foods, 8);
    if (!suggestions.length) { closeSuggest(); return; }
    fill(sugList, ...suggestions.map((f, i) => h('li', {
      id: `${listId}-${i}`, role: 'option', 'aria-selected': 'false',
      onmousedown: (ev) => { ev.preventDefault(); choose(f); },
    }, h('span', null, f.name), h('small', null, `${fmt(f.per100.kcal)} kcal je 100 g`))));
    sugList.hidden = false;
    searchIn.setAttribute('aria-expanded', 'true');
    setActive(-1);
  }

  function onSearchKey(ev) {
    const open = !sugList.hidden && suggestions.length > 0;
    if (ev.key === 'ArrowDown' && open) {
      ev.preventDefault();
      setActive((active + 1) % suggestions.length);
    } else if (ev.key === 'ArrowUp' && open) {
      ev.preventDefault();
      setActive(active <= 0 ? suggestions.length - 1 : active - 1);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (open) choose(suggestions[active >= 0 ? active : 0]);
      else if (chosen) addFromTable();
    } else if (ev.key === 'Escape' && open) {
      ev.preventDefault();
      closeSuggest();
    }
  }

  const addTableBtn = h('button', { class: 'btn', type: 'button', onclick: addFromTable }, 'Hinzufügen');
  gramsAddIn.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); addFromTable(); }
  });

  function addFromTable() {
    if (!chosen) {
      ctx.toast('Bitte zuerst eine Zutat aus den Vorschlägen wählen.', 'warn');
      searchIn.focus();
      return;
    }
    const grams = parseNum(gramsAddIn.value);
    if (!validGrams(grams)) {
      ctx.toast('Gramm zwischen 1 und 5000 angeben.', 'warn');
      gramsAddIn.focus();
      return;
    }
    draft.ingredients.push({
      name: chosen.name, grams, foodId: chosen.id, per100: copyPer100(chosen.per100), source: 'db', note: '',
    });
    persist();
    chosen = null;
    searchIn.value = '';
    gramsAddIn.value = 100;
    renderList();
    updateSummary();
    searchIn.focus();
  }

  // ---------- Eigene Zutat ----------
  const cName = h('input', { class: 'input', type: 'text', maxlength: 80 });
  const cGrams = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: 1, max: 5000, step: 'any', value: 100 });
  const cNum = (v) => h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: v });
  const cKcal = cNum('');
  const cProt = cNum('');
  const cFat = cNum('');
  const cCarb = cNum('');
  const cFiber = cNum(0);
  const customInfo = h('div', { 'aria-live': 'polite' });

  function addCustom() {
    const name = cName.value.trim();
    const grams = parseNum(cGrams.value);
    if (!name) { ctx.toast('Bitte einen Namen eingeben.', 'warn'); cName.focus(); return; }
    if (!validGrams(grams)) { ctx.toast('Gramm zwischen 1 und 5000 angeben.', 'warn'); cGrams.focus(); return; }
    const raw = {
      protein: parseNum(cProt.value) ?? 0,
      fat: parseNum(cFat.value) ?? 0,
      carbs: parseNum(cCarb.value) ?? 0,
      fiber: parseNum(cFiber.value) ?? 0,
    };
    const kcalIn = parseNum(cKcal.value);
    raw.kcal = kcalIn === null ? Math.round(atwaterKcal(raw)) : kcalIn;
    const res = checkPer100(raw);
    draft.ingredients.push({ name, grams, foodId: null, per100: copyPer100(res.fixed), source: 'manual', note: '' });
    persist();
    fill(customInfo, res.problems.length
      ? h('div', { class: 'hint hint-warn' }, h('ul', null, ...res.problems.map((p) => h('li', null, p))))
      : null);
    cName.value = '';
    cGrams.value = 100;
    cKcal.value = '';
    cProt.value = '';
    cFat.value = '';
    cCarb.value = '';
    cFiber.value = 0;
    renderList();
    updateSummary();
    cName.focus();
  }

  // ---------- Zutatenliste ----------
  const listBox = h('div');

  function valuesNodes(m) {
    return [
      h('span', null, h('b', null, fmt(m.kcal)), ' kcal'),
      h('span', { class: 'p' }, 'E ', h('b', null, fmt(m.protein, 1)), ' g'),
      h('span', { class: 'f' }, 'F ', h('b', null, fmt(m.fat, 1)), ' g'),
      h('span', { class: 'c' }, 'KH ', h('b', null, fmt(m.carbs, 1)), ' g'),
    ];
  }

  function effective(ing) {
    return validGrams(Number(ing.grams)) ? ing : { ...ing, grams: 0 };
  }

  function renderList() {
    if (!draft.ingredients.length) {
      fill(listBox, emptyState('Noch keine Zutaten', 'Tippe oben eine Zutatenliste ein oder suche eine Zutat in der Tabelle.'));
      return;
    }
    const wrap = h('div');
    for (const ing of draft.ingredients) {
      const [bCls, bText] = BADGES[ing.source] || BADGES.manual;
      const valuesEl = h('div', { class: 'rc-vals' });
      const gIn = h('input', {
        class: 'input', type: 'number', inputmode: 'decimal', min: 1, max: 5000, step: 'any',
        value: ing.grams, 'aria-label': `Gramm für ${ing.name}`,
        oninput: () => {
          const g = parseNum(gIn.value);
          const ok = validGrams(g);
          gIn.setAttribute('aria-invalid', ok ? 'false' : 'true');
          ing.grams = ok ? g : 0;
          fill(valuesEl, ...valuesNodes(ingredientMacros(ing)));
          persist();
          updateSummary();
        },
      });
      if (!validGrams(Number(ing.grams))) gIn.setAttribute('aria-invalid', 'true');
      fill(valuesEl, ...valuesNodes(ingredientMacros(effective(ing))));
      wrap.appendChild(h('div', { class: 'rc-ing' },
        h('div', { class: 'rc-ing-head' },
          h('div', { class: 'rc-ing-name' }, h('span', null, ing.name), h('span', { class: bCls }, bText)),
          h('div', { class: 'rc-grams' }, gIn, h('span', { class: 'muted' }, 'g')),
          h('button', {
            class: 'btn btn-ghost rc-remove', type: 'button', 'aria-label': `${ing.name} entfernen`,
            onclick: () => {
              draft.ingredients.splice(draft.ingredients.indexOf(ing), 1);
              persist();
              renderList();
              updateSummary();
            },
          }, '✕')),
        ing.note ? h('div', { class: 'rc-ing-note' }, ing.note) : null,
        valuesEl));
    }
    fill(listBox, wrap);
  }

  // ---------- Zusammenfassung ----------
  const portionsIn = h('input', {
    class: 'input', type: 'number', inputmode: 'numeric', min: 1, max: 50, step: 1, value: draft.portions,
    oninput: () => {
      const p = parseNum(portionsIn.value);
      const ok = p !== null && p >= 1 && p <= 50;
      portionsIn.setAttribute('aria-invalid', ok ? 'false' : 'true');
      draft.portions = ok ? p : 1;
      persist();
      updateSummary();
    },
  });
  const summaryBox = h('div', { class: 'stack', 'aria-live': 'polite' });

  function updateSummary() {
    const total = sumMacros(draft.ingredients.map(effective));
    const per = perPortion(total, draft.portions);
    const pct = macroPercents(per);
    const t = ctx.targets;
    const nodes = [
      h('div', { class: 'rc-total' },
        h('strong', null, 'Gesamt:'),
        h('span', null, `${fmt(total.kcal)} kcal`),
        h('span', null, `E ${fmt(total.protein, 1)} g`),
        h('span', null, `F ${fmt(total.fat, 1)} g`),
        h('span', null, `KH ${fmt(total.carbs, 1)} g`)),
      h('strong', null, 'Je Portion'),
      macroSummary(per, t ? t.perMeal : undefined),
      h('div', { class: 'rc-small' },
        `E ${fmt(pct.protein)} % · F ${fmt(pct.fat)} % · KH ${fmt(pct.carbs)} % · Ballaststoffe ${fmt(per.fiber, 1)} g`),
    ];
    if (t) {
      const fit = styleFit(per, t);
      nodes.push(
        h('div', null, h('span', { class: 'chip' }, fit.label)),
        h('div', { class: 'rc-small' },
          `Dein Ziel je Mahlzeit: ${fmt(t.perMeal.kcal)} kcal · E ${fmt(t.perMeal.protein)} g · F ${fmt(t.perMeal.fat)} g · KH ${fmt(t.perMeal.carbs)} g`));
    } else {
      nodes.push(h('div', { class: 'hint stack' },
        h('p', null, 'Ohne Profil gibt es keine Zielwerte.'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => ctx.navigate('#/profil') }, 'Profil ausfüllen')));
    }
    fill(summaryBox, ...nodes);
  }

  // ---------- Speichern / Leeren ----------
  const nameIn = h('input', {
    class: 'input', type: 'text', maxlength: 80, value: draft.name,
    oninput: () => { draft.name = nameIn.value; persist(); },
  });
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => save(draft.recipeId) },
    draft.recipeId ? 'Änderungen speichern' : 'Als Rezept speichern');
  const saveNewBtn = draft.recipeId
    ? h('button', { class: 'btn', type: 'button', onclick: () => save(null) }, 'Als neues Rezept speichern')
    : null;
  const clearBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: clearAll }, 'Leeren');

  async function save(id) {
    const name = nameIn.value.trim();
    const ingredients = draft.ingredients
      .filter((i) => validGrams(Number(i.grams)))
      .map((i) => ({ ...i, per100: copyPer100(i.per100) }));
    if (!name) { ctx.toast('Bitte einen Rezeptnamen eingeben.', 'warn'); nameIn.focus(); return; }
    if (!ingredients.length) { ctx.toast('Mindestens eine Zutat mit Gramm über 0 nötig.', 'warn'); return; }
    const body = { name, portions: draft.portions, ingredients };
    const btns = [saveBtn, saveNewBtn, clearBtn].filter(Boolean);
    btns.forEach((b) => { b.disabled = true; });
    try {
      if (id) await ctx.api.updateRecipe(id, body);
      else await ctx.api.createRecipe(body);
      clearDraftStorage();
      ctx.toast('Rezept gespeichert', 'ok');
      await ctx.refresh();
    } catch (err) {
      ctx.toast(err.message, 'error');
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  async function clearAll() {
    const hasContent = draft.ingredients.length > 0 || draft.name.trim() !== '' || draft.recipeId;
    if (hasContent && !(await confirmDialog('Entwurf wirklich leeren?', 'Leeren'))) return;
    clearDraftStorage();
    await render(root, ctx);
  }

  // ---------- Aufbau ----------
  const inputCard = h('section', { class: 'card stack', 'aria-label': 'Zutaten hinzufügen' },
    h('h2', { class: 'card-title' }, 'Zutaten hinzufügen'),
    field('Zutaten eintippen', textArea),
    h('div', { class: 'row' }, recognizeBtn),
    parseInfo,
    h('div', { class: 'stack' },
      h('strong', null, 'Aus der Tabelle'),
      h('div', { class: 'rc-add' },
        h('div', { class: 'rc-suggest-wrap' }, field('Zutat suchen', searchIn), sugList),
        field('Gramm', gramsAddIn),
        addTableBtn)),
    h('details', null,
      h('summary', { style: { minHeight: '44px', display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: '600' } },
        'Eigene Zutat mit Nährwerten'),
      h('div', { class: 'stack' },
        h('div', { class: 'rc-custom-grid' },
          h('div', { class: 'wide' }, field('Name', cName)),
          field('Gramm', cGrams),
          field('kcal je 100 g', cKcal),
          field('Eiweiß je 100 g (g)', cProt),
          field('Fett je 100 g (g)', cFat),
          field('Kohlenhydrate je 100 g (g)', cCarb),
          field('Ballaststoffe je 100 g (g)', cFiber)),
        customInfo,
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: addCustom }, 'Zutat hinzufügen')))));

  const listCard = h('section', { class: 'card', 'aria-label': 'Zutatenliste' },
    h('div', { class: 'row between' },
      h('h2', { class: 'card-title', style: { marginBottom: 0 } }, draft.recipeId ? 'Zutaten (Rezept bearbeiten)' : 'Zutaten'),
      clearBtn),
    listBox);

  const summaryCard = h('aside', { class: 'card stack', 'aria-label': 'Zusammenfassung' },
    h('h2', { class: 'card-title' }, 'Zusammenfassung'),
    field('Portionen', portionsIn, 'Zwischen 1 und 50'),
    summaryBox,
    h('div', { class: 'stack' },
      field('Rezeptname', nameIn),
      h('div', { class: 'row' }, saveBtn, saveNewBtn)));

  fill(root, 
    h('div', { class: 'page' },
      h('h1', { class: 'page-title' }, 'Rechner'),
      inputCard,
      h('div', { class: 'grid-2' }, listCard, summaryCard)));

  renderList();
  updateSummary();
}
