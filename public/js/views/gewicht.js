// Gewichts-Tracker: Eintragen, Kennzahlen, Verlaufsdiagramm und Einträge. Kein innerHTML.
import { h, fill, fmt, fmtKg, todayISO, formatDate, statTile, field, confirmDialog, emptyState } from '../ui.js';
import { sortEntries, movingAverage, weightStats } from '../core/weight.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CSS_HREF = 'css/views/gewicht.css';
const LIST_LIMIT = 30;
const DAY_MS = 86400000;
const W = 600;
const H = 260;
const PAD = { top: 14, right: 16, bottom: 34, left: 48 };

function dayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS : NaN;
}

function ensureStylesheet() {
  if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href: CSS_HREF }));
}

// Vorzeichen mit echtem Minuszeichen, auf eine Nachkommastelle gerundet.
function signed(n, unit) {
  const r = Math.round(Number(n) * 10) / 10;
  if (!Number.isFinite(r)) return '–';
  const sign = r > 0 ? '+' : r < 0 ? '−' : '';
  return `${sign}${fmt(Math.abs(r), 1)}${unit ? ' ' + unit : ''}`;
}

// SVG-Element erzeugen (h() kennt kein SVG-text).
function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// entries: sortiert, mindestens zwei Einträge. avg: 7-Tage-Mittel je Eintragsdatum.
function buildChart(entries, avg, goal) {
  const first = entries[0].date;
  const last = entries[entries.length - 1].date;
  const span = Math.max(1, dayNumber(last) - dayNumber(first));

  const values = entries.map((e) => e.kg);
  if (goal !== null) values.push(goal);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.05;
  let lo = min - pad;
  let hi = max + pad;
  if (hi - lo < 1) {
    const mid = (lo + hi) / 2;
    lo = mid - 0.5;
    hi = mid + 0.5;
  }

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (date) => PAD.left + ((dayNumber(date) - dayNumber(first)) / span) * plotW;
  const y = (kg) => PAD.top + ((hi - kg) / (hi - lo)) * plotH;
  const line = (list) => list.map((e) => `${x(e.date).toFixed(1)},${y(e.kg).toFixed(1)}`).join(' ');

  const parts = [];
  for (let i = 0; i < 4; i++) {
    const v = hi - ((hi - lo) * i) / 3;
    const gy = y(v).toFixed(1);
    parts.push(s('line', { class: 'chart-grid', x1: PAD.left, x2: W - PAD.right, y1: gy, y2: gy }));
    parts.push(s('text', { class: 'chart-axis', x: PAD.left - 8, y: gy, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, fmt(v, 1)));
  }

  if (goal !== null) {
    const gy = y(goal).toFixed(1);
    parts.push(s('line', { class: 'chart-goal', x1: PAD.left, x2: W - PAD.right, y1: gy, y2: gy }));
    parts.push(s('text', { class: 'chart-goal-label', x: W - PAD.right, y: (Number(gy) - 6).toFixed(1), 'text-anchor': 'end' }, 'Wunschgewicht'));
  }

  parts.push(s('text', { class: 'chart-axis', x: PAD.left, y: H - 10 }, formatDate(first)));
  parts.push(s('text', { class: 'chart-axis', x: W - PAD.right, y: H - 10, 'text-anchor': 'end' }, formatDate(last)));
  parts.push(s('polyline', { class: 'chart-raw', points: line(entries) }));
  for (const e of entries) {
    parts.push(s('circle', { class: 'chart-dot', cx: x(e.date).toFixed(1), cy: y(e.kg).toFixed(1), r: 3.5 },
      s('title', null, `${formatDate(e.date)}: ${fmtKg(e.kg)}`)));
  }
  parts.push(s('polyline', { class: 'chart-avg', points: line(avg) }));

  return s('svg', {
    class: 'chart',
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    role: 'img',
    'aria-label': `Gewichtsverlauf von ${formatDate(first)} bis ${formatDate(last)}`,
  }, ...parts);
}

export async function render(root, ctx) {
  ensureStylesheet();

  const weights = ctx.state.weights || [];
  const profile = ctx.state.profile;
  const entries = sortEntries(weights);
  const goalRaw = profile && profile.goalWeightKg;
  const goal = goalRaw !== null && goalRaw !== undefined && Number.isFinite(Number(goalRaw)) && Number(goalRaw) > 0
    ? Number(goalRaw)
    : null;

  // Eintragen
  const today = todayISO();
  const dateIn = h('input', { class: 'input', type: 'date', name: 'date', value: today, max: today, required: true });
  const kgIn = h('input', {
    class: 'input', type: 'number', name: 'kg', step: '0.1', min: 30, max: 300,
    inputmode: 'decimal', placeholder: 'z. B. 64,5', required: true,
  });
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Speichern');
  const form = h('form', { class: 'card stack weight-form', novalidate: true, onsubmit: onSubmit },
    h('h2', { class: 'card-title' }, 'Eintragen'),
    h('div', { class: 'form-grid' }, field('Datum', dateIn), field('Gewicht (kg)', kgIn)),
    h('p', { class: 'muted' }, 'Ein Eintrag pro Tag. Ein neuer Wert für denselben Tag ersetzt den alten.'),
    h('div', { class: 'row' }, saveBtn));

  async function onSubmit(ev) {
    ev.preventDefault();
    const date = dateIn.value;
    const kg = Number(String(kgIn.value).trim().replace(',', '.'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayISO()) {
      ctx.toast('Bitte ein Datum wählen, das nicht in der Zukunft liegt.', 'warn');
      return;
    }
    if (!Number.isFinite(kg) || kg < 30 || kg > 300) {
      ctx.toast('Bitte ein Gewicht zwischen 30 und 300 kg eingeben.', 'warn');
      return;
    }
    saveBtn.disabled = true;
    try {
      await ctx.api.setWeight(date, Math.round(kg * 10) / 10);
      ctx.toast('Gewicht gespeichert', 'ok');
      await ctx.refresh();
    } catch (err) {
      ctx.toast(err.message, 'error');
      saveBtn.disabled = false;
    }
  }

  const sections = [form];

  if (entries.length === 0) {
    sections.push(emptyState('Noch keine Einträge', 'Trag dein erstes Gewicht ein, dann siehst du hier deinen Verlauf.'));
  } else {
    // Kennzahlen
    const stats = weightStats(weights, profile);
    if (stats) {
      const tiles = [
        statTile('Aktuell', fmtKg(stats.current)),
        statTile('Start', fmtKg(stats.start)),
        statTile('Veränderung', signed(stats.change, 'kg')),
      ];
      if (stats.bmi !== null) tiles.push(statTile('BMI', fmt(stats.bmi, 1)));
      if (stats.weeklyRate !== null) tiles.push(statTile('Trend pro Woche', signed(stats.weeklyRate, 'kg'), 'letzte 28 Tage'));
      if (stats.toGoal !== null) {
        const far = Math.abs(stats.toGoal) >= 0.05;
        tiles.push(statTile(
          'Bis zum Wunschgewicht',
          far ? fmtKg(Math.abs(stats.toGoal)) : 'erreicht',
          far ? (stats.toGoal < 0 ? 'weniger als jetzt' : 'mehr als jetzt') : null));
      }
      sections.push(h('div', { class: 'stat-grid' }, ...tiles));
    }

    // Verlauf
    const chartCard = h('section', { class: 'card stack' }, h('h2', { class: 'card-title' }, 'Verlauf'));
    if (entries.length < 2) {
      chartCard.appendChild(h('p', { class: 'muted' }, 'Ab zwei Einträgen erscheint hier dein Verlauf.'));
    } else {
      const avg = movingAverage(weights, 7);
      chartCard.append(
        buildChart(entries, avg, goal),
        h('div', { class: 'chart-legend' },
          h('span', { class: 'legend-item' }, h('span', { class: 'swatch', 'aria-hidden': 'true' }), 'Messwerte'),
          h('span', { class: 'legend-item' }, h('span', { class: 'swatch swatch-avg', 'aria-hidden': 'true' }), '7-Tage-Mittel'),
          goal !== null
            ? h('span', { class: 'legend-item' }, h('span', { class: 'swatch swatch-goal', 'aria-hidden': 'true' }), 'Wunschgewicht')
            : null));
    }
    sections.push(chartCard);

    // Einträge, neueste zuerst
    let showAll = false;
    const listBody = h('div', { class: 'stack' });
    const listCard = h('section', { class: 'card stack' }, h('h2', { class: 'card-title' }, 'Einträge'), listBody);
    const desc = entries.slice().reverse();

    async function removeEntry(e) {
      const ok = await confirmDialog(`Eintrag vom ${formatDate(e.date)} löschen?`, 'Löschen');
      if (!ok) return;
      try {
        await ctx.api.deleteWeight(e.date);
        ctx.toast('Eintrag gelöscht', 'ok');
        await ctx.refresh();
      } catch (err) {
        ctx.toast(err.message, 'error');
      }
    }

    function drawList() {
      const shown = showAll ? desc : desc.slice(0, LIST_LIMIT);
      const items = shown.map((e, d) => {
        const idx = entries.length - 1 - d;
        const prev = idx > 0 ? entries[idx - 1] : null;
        return h('li', { class: 'list-item' },
          h('span', { class: 'entry-date' }, formatDate(e.date)),
          h('span', { class: 'entry-kg num' }, fmtKg(e.kg)),
          h('span', { class: 'entry-diff muted' }, prev ? signed(e.kg - prev.kg, 'kg') : ''),
          h('button', {
            class: 'btn btn-ghost btn-small', type: 'button',
            'aria-label': `Eintrag vom ${formatDate(e.date)} löschen`,
            onclick: () => removeEntry(e),
          }, 'Löschen'));
      });
      const more = !showAll && desc.length > LIST_LIMIT
        ? h('button', {
          class: 'btn btn-small', type: 'button',
          onclick: () => { showAll = true; drawList(); },
        }, `Alle anzeigen (${desc.length})`)
        : null;
      fill(listBody, h('ul', { class: 'list weight-list' }, ...items), more);
    }
    drawList();
    sections.push(listCard);
  }

  fill(root, 
    h('div', { class: 'page' },
      h('h1', { class: 'page-title' }, 'Gewicht'),
      h('div', { class: 'stack' }, ...sections)));
}
