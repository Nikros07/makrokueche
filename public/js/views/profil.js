// Profil: Fragebogen mit Live-Vorschau der Tagesziele.
import { h, fill, fmt, field, confirmDialog, todayISO } from '../ui.js';
import { calcTargets, STYLES } from '../core/targets.js';

const SEX = [['w', 'Weiblich'], ['m', 'Männlich']];
const ACTIVITY = [
  ['sitzend', 'Sitzend', 'Schreibtisch, kaum Bewegung im Alltag'],
  ['leicht', 'Leicht aktiv', 'Viel Gehen oder Stehen, etwas Sport'],
  ['aktiv', 'Aktiv', 'Regelmäßig Training, bewegter Alltag'],
  ['sehr-aktiv', 'Sehr aktiv', 'Körperliche Arbeit oder tägliches hartes Training'],
];
const GOAL = [['abnehmen', 'Abnehmen'], ['halten', 'Halten'], ['aufbauen', 'Aufbauen']];
const MEALS = [[2, '2 Mahlzeiten'], [3, '3 Mahlzeiten'], [4, '4 Mahlzeiten']];

const DEFAULTS = { sex: 'w', age: '', heightCm: '', weightKg: '', activity: 'leicht', goal: 'halten', style: 'ausgewogen', meals: 3, goalWeightKg: '' };

function radioGroup(legend, name, options, current, onChange, { cards = false } = {}) {
  const group = h('div', { class: ['segmented', cards && 'cards'], role: 'radiogroup' });
  for (const [value, label, hint] of options) {
    group.appendChild(h('label', null,
      h('input', { type: 'radio', name, value: String(value), checked: String(value) === String(current), onchange: onChange }),
      h('span', { class: 'seg-face' }, h('strong', null, label), hint ? h('small', null, hint) : null)));
  }
  return h('fieldset', { class: 'fieldset' }, h('legend', null, legend), group);
}

function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export async function render(root, ctx) {
  const saved = ctx.state.profile;
  const vals = { ...DEFAULTS, ...(saved || {}) };
  if (vals.goalWeightKg === null) vals.goalWeightKg = '';

  // KI-Einstellungen für die Karte "KI-Zugang". Bei Fehler kein Absturz, die Karte zeigt einen Hinweis.
  let settings = null;
  try {
    settings = await ctx.api.getSettings();
  } catch (err) {
    settings = null;
  }

  const form = h('form', { class: 'card stack', novalidate: true, onsubmit: onSubmit });
  const previewBox = h('div', { class: 'stack', 'aria-live': 'polite' });
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, saved ? 'Änderungen speichern' : 'Profil speichern');

  const numInput = (name, attrs) => h('input', {
    class: 'input', type: 'number', inputmode: 'decimal', name, value: vals[name] ?? '', required: attrs.required,
    min: attrs.min, max: attrs.max, step: attrs.step, oninput: update,
  });
  const ageIn = numInput('age', { required: true, min: 10, max: 100, step: 1 });
  const heightIn = numInput('heightCm', { required: true, min: 120, max: 230, step: 1 });
  const weightIn = numInput('weightKg', { required: true, min: 30, max: 300, step: 0.1 });
  const goalWIn = numInput('goalWeightKg', { required: false, min: 30, max: 300, step: 0.1 });

  const styleOptions = Object.entries(STYLES).map(([key, s]) => [key, s.label, s.hint]);

  form.append(
    radioGroup('Geschlecht', 'sex', SEX, vals.sex, update),
    h('div', { class: 'form-grid' },
      field('Alter (Jahre)', ageIn),
      field('Größe (cm)', heightIn),
      field('Gewicht (kg)', weightIn),
      field('Wunschgewicht (kg, optional)', goalWIn)),
    radioGroup('Alltag und Bewegung', 'activity', ACTIVITY, vals.activity, update, { cards: true }),
    radioGroup('Ziel', 'goal', GOAL, vals.goal, update),
    radioGroup('Ernährungsstil', 'style', styleOptions, vals.style, update, { cards: true }),
    radioGroup('Mahlzeiten pro Tag', 'meals', MEALS, vals.meals, update),
    h('div', { class: 'row' }, saveBtn));

  const previewCard = h('aside', { class: 'card preview stack', 'aria-label': 'Vorschau deiner Tagesziele' },
    h('h2', { class: 'card-title' }, 'Deine Tagesziele'),
    previewBox,
    h('p', { class: 'hint' }, 'Die Werte sind Orientierung und ersetzen keine ärztliche oder ernährungsfachliche Beratung.'));

  fill(root, 
    h('div', { class: 'page' },
      h('h1', { class: 'page-title' }, 'Profil'),
      saved ? null : h('p', { class: 'muted' }, 'Ein paar Angaben, und die App rechnet deine persönlichen Tagesziele aus.'),
      h('div', { class: 'grid-2' }, form, previewCard)));

  // Zusatzkarten unter dem Fragebogen, innerhalb derselben .page.
  ensureProfilStyles();
  root.querySelector('.page').appendChild(
    h('div', { class: 'stack profil-extra' }, aiCard(ctx, settings), backupCard(ctx)));

  function read() {
    const fd = new FormData(form);
    return {
      sex: fd.get('sex'),
      age: num(ageIn.value),
      heightCm: num(heightIn.value),
      weightKg: num(weightIn.value),
      activity: fd.get('activity'),
      goal: fd.get('goal'),
      style: fd.get('style'),
      meals: Number(fd.get('meals')),
      goalWeightKg: num(goalWIn.value),
    };
  }

  function problems(p) {
    const list = [];
    if (!(p.age >= 10 && p.age <= 100)) list.push('Alter zwischen 10 und 100 Jahren');
    if (!(p.heightCm >= 120 && p.heightCm <= 230)) list.push('Größe zwischen 120 und 230 cm');
    if (!(p.weightKg >= 30 && p.weightKg <= 300)) list.push('Gewicht zwischen 30 und 300 kg');
    if (p.goalWeightKg !== null && !(p.goalWeightKg >= 30 && p.goalWeightKg <= 300)) list.push('Wunschgewicht zwischen 30 und 300 kg');
    return list;
  }

  function update() {
    const p = read();
    const missing = problems(p);
    if (missing.length) {
      fill(previewBox, h('p', { class: 'muted' }, `Für die Vorschau fehlt noch: ${missing.join(', ')}.`));
      return;
    }
    let t;
    try {
      t = calcTargets(p);
    } catch (err) {
      fill(previewBox, h('p', { class: 'muted' }, 'Mit diesen Angaben lässt sich nichts berechnen.'));
      return;
    }
    const tile = (label, value, unit, color) => h('div', null, h('b', { style: color ? { color } : undefined }, value), h('small', null, `${label}${unit ? ' ' + unit : ''}`));
    fill(previewBox, 
      h('div', { class: 'kcal-big' }, h('strong', null, fmt(t.kcal)), h('span', null, 'kcal pro Tag')),
      h('div', { class: 'mini-grid' },
        tile('Eiweiß', `${fmt(t.protein)} g`, '', 'var(--c-protein)'),
        tile('Fett', `${fmt(t.fat)} g`, '', 'var(--c-fat)'),
        tile('Kohlenhydrate', `${fmt(t.carbs)} g`, '', 'var(--c-carbs)')),
      h('div', { class: 'stack' },
        h('strong', null, `Je Mahlzeit (${p.meals} am Tag)`),
        h('div', { class: 'mini-grid' },
          tile('kcal', fmt(t.perMeal.kcal)),
          tile('Eiweiß', `${fmt(t.perMeal.protein)} g`),
          tile('Fett', `${fmt(t.perMeal.fat)} g`),
          tile('Kohlenhydrate', `${fmt(t.perMeal.carbs)} g`))),
      h('p', { class: 'muted', style: { fontSize: '0.85rem' } },
        `Grundumsatz ${fmt(t.bmr)} kcal · Gesamtumsatz ${fmt(t.tdee)} kcal`),
      // replaceChildren würde ein nacktes null als Text "null" einfügen, deshalb als Liste spreizen.
      ...(t.warnings && t.warnings.length
        ? [h('div', { class: 'hint hint-warn' }, h('ul', null, ...t.warnings.map((w) => h('li', null, w))))]
        : []));
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    const p = read();
    const missing = problems(p);
    if (missing.length) {
      ctx.toast(`Bitte prüfen: ${missing.join(', ')}.`, 'warn');
      return;
    }
    saveBtn.disabled = true;
    try {
      await ctx.api.saveProfile(p);
      ctx.toast('Profil gespeichert.', 'ok');
      const first = !saved;
      await ctx.refresh();
      if (first) ctx.navigate('#/rechner');
    } catch (err) {
      ctx.toast(err.message, 'error');
      saveBtn.disabled = false;
    }
  }

  update();
}

const PROFIL_CSS = 'css/views/profil.css';
const MAX_BACKUP_BYTES = 2 * 1024 * 1024;

// Stylesheet der Profil-Ansicht genau einmal einhängen.
function ensureProfilStyles() {
  if (document.querySelector(`link[href="${PROFIL_CSS}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href: PROFIL_CSS }));
}

function errText(err, fallback) {
  return err && typeof err.message === 'string' && err.message ? err.message : fallback;
}

function aiCard(ctx, settings) {
  const card = h('section', { class: 'card stack profil-keys' }, h('h2', { class: 'card-title' }, 'KI-Zugang'));
  if (!settings) {
    card.appendChild(h('p', { class: 'hint' }, 'Die KI-Einstellungen konnten nicht geladen werden. Lade die Seite neu, um es erneut zu versuchen.'));
    return card;
  }

  const s = {
    geminiKey: String(settings.geminiKey ?? ''),
    openrouterKey: String(settings.openrouterKey ?? ''),
    geminiModel: String(settings.geminiModel ?? ''),
    openrouterModel: String(settings.openrouterModel ?? ''),
  };
  let stored = { ...s };

  const geminiIn = h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', value: s.geminiKey });
  const openrouterIn = h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', value: s.openrouterKey });
  const gModelIn = h('input', { class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', value: s.geminiModel });
  const oModelIn = h('input', { class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', value: s.openrouterModel });
  const showBox = h('input', {
    type: 'checkbox',
    onchange: () => {
      const t = showBox.checked ? 'text' : 'password';
      geminiIn.type = t;
      openrouterIn.type = t;
    },
  });

  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: onSave }, 'Speichern');
  const testBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: onTest }, 'KI testen');
  const clearBtn = h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: onClear }, 'Keys löschen');
  const result = h('div', { 'aria-live': 'polite' });

  card.append(
    h('p', { class: 'muted' }, 'Mit einem Key erkennt die KI deine eingetippten Zutaten. Ohne Key arbeitet die App mit dem eingebauten Parser. Die Keys bleiben nur in diesem Browser gespeichert und gehen ausschließlich an Google bzw. OpenRouter. Auf jedem Gerät einmal eintragen.'),
    field('Google-AI-Key (Gemini)', geminiIn, 'Kostenlos unter aistudio.google.com/apikey. Projekt ohne hinterlegte Abrechnung nutzen, dann bleibt es gratis.'),
    field('OpenRouter-Key', openrouterIn, 'Kostenlos unter openrouter.ai/keys. Wird nur genutzt, wenn Gemini nicht antwortet.'),
    h('label', { class: 'key-toggle' }, showBox, h('span', null, 'Keys anzeigen')),
    h('details', null,
      h('summary', null, 'Erweitert'),
      h('div', { class: 'stack' },
        field('Gemini-Modell', gModelIn),
        field('OpenRouter-Modell', oModelIn),
        h('p', { class: 'hint' }, 'Nur ändern, wenn ein Modell nicht mehr verfügbar ist.'))),
    h('div', { class: 'row' }, saveBtn, testBtn, clearBtn),
    result);

  function collect() {
    return {
      geminiKey: geminiIn.value.trim(),
      openrouterKey: openrouterIn.value.trim(),
      geminiModel: gModelIn.value.trim(),
      openrouterModel: oModelIn.value.trim(),
    };
  }

  async function store(data) {
    const saved = await ctx.api.saveSettings(data);
    stored = saved && typeof saved === 'object' ? { ...data, ...saved } : { ...data };
  }

  async function onSave() {
    saveBtn.disabled = true;
    try {
      await store(collect());
      ctx.toast('KI-Zugang gespeichert', 'ok');
      await ctx.refresh();
    } catch (err) {
      ctx.toast(errText(err, 'Die Einstellungen konnten nicht gespeichert werden.'), 'error');
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function onTest() {
    testBtn.disabled = true;
    testBtn.textContent = 'Teste …';
    fill(result);
    try {
      await store(collect());
      const r = await ctx.api.parseIngredients('100 g Butter');
      const text = r.provider === 'gemini'
        ? 'Gemini antwortet.'
        : r.provider === 'openrouter'
          ? 'OpenRouter antwortet. (Gemini hat nicht geantwortet.)'
          : 'Keine KI erreichbar. Die App nutzt den eingebauten Parser.';
      const warnings = Array.isArray(r.warnings) ? r.warnings.filter(Boolean) : [];
      fill(result, h('div', { class: 'hint' },
        h('p', null, text),
        warnings.length ? h('ul', null, ...warnings.map((w) => h('li', null, String(w)))) : null));
    } catch (err) {
      ctx.toast(errText(err, 'Der KI-Test ist fehlgeschlagen.'), 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'KI testen';
    }
  }

  async function onClear() {
    const ok = await confirmDialog('Beide Keys aus diesem Browser löschen?', 'Löschen');
    if (!ok) return;
    clearBtn.disabled = true;
    try {
      // Modelle bleiben erhalten, nur die Keys werden geleert.
      await store({ geminiKey: '', openrouterKey: '', geminiModel: stored.geminiModel, openrouterModel: stored.openrouterModel });
      geminiIn.value = '';
      openrouterIn.value = '';
      ctx.toast('Keys gelöscht', 'ok');
      await ctx.refresh();
    } catch (err) {
      ctx.toast(errText(err, 'Die Keys konnten nicht gelöscht werden.'), 'error');
    } finally {
      clearBtn.disabled = false;
    }
  }

  return card;
}

function backupCard(ctx) {
  const exportBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: onExport }, 'Sicherung herunterladen');
  const fileIn = h('input', { class: 'input', type: 'file', accept: 'application/json,.json', onchange: onFile });

  async function onExport() {
    exportBtn.disabled = true;
    try {
      const data = await ctx.api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `makrokueche-${todayISO()}.json`, style: { display: 'none' } });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      ctx.toast('Sicherung gespeichert', 'ok');
    } catch (err) {
      ctx.toast(errText(err, 'Die Sicherung konnte nicht erstellt werden.'), 'error');
    } finally {
      exportBtn.disabled = false;
    }
  }

  async function onFile() {
    const file = fileIn.files && fileIn.files[0];
    fileIn.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      ctx.toast('Die Datei ist größer als 2 MB.', 'error');
      return;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      ctx.toast('Die Datei ist keine gültige Sicherung.', 'error');
      return;
    }
    const ok = await confirmDialog('Die Sicherung ersetzt alle Daten in diesem Browser. Fortfahren?', 'Ersetzen');
    if (!ok) return;
    try {
      await ctx.api.importData(data);
      ctx.toast('Daten eingespielt', 'ok');
      await ctx.refresh();
    } catch (err) {
      ctx.toast(errText(err, 'Die Sicherung konnte nicht eingespielt werden.'), 'error');
    }
  }

  return h('section', { class: 'card stack profil-backup' },
    h('h2', { class: 'card-title' }, 'Daten sichern'),
    h('p', { class: 'muted' }, 'Deine Daten liegen nur in diesem Browser. Mit einer Sicherung ziehst du sie auf ein anderes Gerät um oder schützt sie davor, dass der Browser sie beim Aufräumen löscht. Die Keys sind nicht Teil der Sicherung.'),
    h('div', { class: 'row' }, exportBtn),
    field('Sicherung einspielen', fileIn, 'Nur Dateien aus dieser App (JSON, höchstens 2 MB).'));
}
