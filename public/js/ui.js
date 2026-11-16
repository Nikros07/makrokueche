// DOM-Helfer, Formatierer und wiederverwendbare Bausteine. Nie innerHTML.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'ellipse']);
const PROP_ATTRS = new Set(['value', 'checked', 'selected', 'disabled', 'indeterminate']);

function append(el, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (const c of child) append(el, c);
  } else if (child instanceof Node) {
    el.appendChild(child);
  } else {
    el.appendChild(document.createTextNode(String(child)));
  }
}

// Inhalt eines Elements ersetzen. Anders als das native replaceChildren() werden null/false
// übersprungen (nativ würde daraus der sichtbare Text "null") und Arrays aufgelöst.
export function fill(el, ...children) {
  el.replaceChildren();
  for (const c of children) append(el, c);
  return el;
}

export function h(tag, attrs, ...children) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [key, val] of Object.entries(attrs)) {
      if (val === null || val === undefined || val === false) continue;
      if (key === 'class' || key === 'className') {
        el.setAttribute('class', Array.isArray(val) ? val.filter(Boolean).join(' ') : String(val));
      } else if (key === 'dataset') {
        for (const [dk, dv] of Object.entries(val)) if (dv !== null && dv !== undefined) el.dataset[dk] = String(dv);
      } else if (key === 'style' && typeof val === 'object') {
        Object.assign(el.style, val);
      } else if (key.startsWith('on') && typeof val === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (PROP_ATTRS.has(key) && !SVG_TAGS.has(tag)) {
        el[key] = val;
        if (val === true && key !== 'value') el.setAttribute(key, '');
      } else if (val === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(val));
      }
    }
  } else {
    children.unshift(attrs);
  }
  for (const c of children) append(el, c);
  return el;
}

const nfCache = new Map();
function nf(digits) {
  if (!nfCache.has(digits)) {
    nfCache.set(digits, new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return nfCache.get(digits);
}

export function fmt(n, digits = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '–';
  return nf(digits).format(v);
}

export function fmtKg(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '–';
  return `${fmt(v, 1)} kg`;
}

export function todayISO() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '');
}

export function toast(text, kind = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  const k = ['ok', 'warn', 'error'].includes(kind) ? kind : 'ok';
  const el = h('div', { class: `toast toast-${k}`, role: k === 'error' ? 'alert' : 'status' }, text);
  host.appendChild(el);
  const ms = k === 'error' ? 6000 : 3500;
  setTimeout(() => el.remove(), ms);
  return el;
}

const MACRO_ROWS = [
  { key: 'protein', label: 'Eiweiß' },
  { key: 'fat', label: 'Fett' },
  { key: 'carbs', label: 'Kohlenhydrate' },
];

export function macroSummary(macros, target) {
  const m = macros || {};
  const kcal = Number(m.kcal) || 0;
  const root = h('div', { class: 'macro-summary' });

  const kcalLine = h('div', { class: 'kcal-big' },
    h('strong', null, fmt(kcal)),
    h('span', null, target && target.kcal ? `von ${fmt(target.kcal)} kcal` : 'kcal'));
  root.appendChild(kcalLine);
  if (target && target.kcal) {
    const pct = Math.min(100, (kcal / target.kcal) * 100);
    root.appendChild(h('div', {
      class: ['progress', kcal > target.kcal * 1.05 && 'over'],
      role: 'progressbar', 'aria-label': 'Energie', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct),
    }, h('span', { style: { width: `${pct}%`, '--bar': 'var(--accent)' } })));
  }

  for (const { key, label } of MACRO_ROWS) {
    const val = Number(m[key]) || 0;
    const tgt = target ? Number(target[key]) : NaN;
    const head = h('div', { class: 'head' },
      h('span', { class: 'name' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), label),
      h('span', null, Number.isFinite(tgt) && tgt > 0 ? `${fmt(val)} / ${fmt(tgt)} g` : `${fmt(val)} g`));
    const line = h('div', { class: `macro-line ${key}` }, head);
    if (Number.isFinite(tgt) && tgt > 0) {
      const pct = Math.min(100, (val / tgt) * 100);
      line.appendChild(h('div', {
        class: ['progress', val > tgt * 1.1 && 'over'],
        role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct),
      }, h('span', { style: { width: `${pct}%` } })));
    }
    root.appendChild(line);
  }

  if (!target) {
    const e = { protein: 4 * (Number(m.protein) || 0), fat: 9 * (Number(m.fat) || 0), carbs: 4 * (Number(m.carbs) || 0) };
    const sum = e.protein + e.fat + e.carbs;
    if (sum > 0) {
      const p = (x) => (x / sum) * 100;
      const text = `Energieanteile: Eiweiß ${fmt(p(e.protein))} %, Fett ${fmt(p(e.fat))} %, Kohlenhydrate ${fmt(p(e.carbs))} %`;
      root.appendChild(h('div', { class: 'macro-bar', role: 'img', 'aria-label': text, title: text },
        h('span', { class: 'seg-protein', style: { width: `${p(e.protein)}%` } }),
        h('span', { class: 'seg-fat', style: { width: `${p(e.fat)}%` } }),
        h('span', { class: 'seg-carbs', style: { width: `${p(e.carbs)}%` } })));
    }
  }
  return root;
}

export function statTile(label, value, hint) {
  return h('div', { class: 'stat' },
    h('span', { class: 'stat-label' }, label),
    h('span', { class: 'stat-value' }, value),
    hint ? h('span', { class: 'stat-hint' }, hint) : null);
}

export function emptyState(title, text, actionLabel, onAction) {
  return h('div', { class: 'card empty' },
    h('h2', null, title),
    text ? h('p', null, text) : null,
    actionLabel && onAction ? h('button', { class: 'btn btn-primary', type: 'button', onclick: onAction }, actionLabel) : null);
}

export function confirmDialog(text, confirmLabel = 'Löschen') {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'confirm', 'aria-label': 'Bestätigen' });
    let result = false;
    const ok = h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { result = true; dlg.close(); } }, confirmLabel);
    const cancel = h('button', { class: 'btn', type: 'button', autofocus: true, onclick: () => dlg.close() }, 'Abbrechen');
    dlg.append(h('p', null, text), h('div', { class: 'row' }, cancel, ok));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.appendChild(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else { dlg.setAttribute('open', ''); }
    cancel.focus();
  });
}

let fieldSeq = 0;
export function field(label, inputEl, hint) {
  fieldSeq += 1;
  const id = inputEl && inputEl.id ? inputEl.id : `f${fieldSeq}`;
  if (inputEl && !inputEl.id) inputEl.id = id;
  const hintId = `${id}-hint`;
  if (hint && inputEl) inputEl.setAttribute('aria-describedby', hintId);
  return h('div', { class: 'field' },
    h('label', { class: 'field-label', for: id }, label),
    inputEl,
    hint ? h('span', { class: 'field-hint', id: hintId }, hint) : null);
}
