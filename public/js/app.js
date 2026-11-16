// Einstieg: lädt Daten, Hash-Router, Navigation, ctx für die Ansichten.
import { api } from './api.js';
import { h, toast } from './ui.js';
import { calcTargets } from './core/targets.js';

const ROUTES = [
  { id: 'rechner', label: 'Rechner', icon: ['M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M8 7h8', 'M8 12h2', 'M14 12h2', 'M8 16h2', 'M14 16h2'] },
  { id: 'rezepte', label: 'Rezepte', icon: ['M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z', 'M5 17a3 3 0 0 1 3-3h11', 'M9 8h6'] },
  { id: 'einkauf', label: 'Einkauf', icon: ['M4 5h2l2 10h9l2-7H7', 'M9 20h.01', 'M17 20h.01'] },
  { id: 'gewicht', label: 'Gewicht', icon: ['M4 19V5', 'M4 19h16', 'M7 15l4-4 3 3 5-6'] },
  { id: 'profil', label: 'Profil', icon: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6'] },
];
const DEFAULT_ROUTE = 'rechner';

const appEl = document.getElementById('app');
const data = { state: null, foods: [], health: null };
let viewEl = null;
let navEls = [];
let renderSeq = 0;

function icon(paths) {
  return h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    ...paths.map((d) => h('path', { d })));
}

function currentRoute() {
  const id = (location.hash.replace(/^#\/?/, '').split('?')[0] || '').trim();
  return ROUTES.some((r) => r.id === id) ? id : null;
}

function navigate(hash) {
  const target = hash.startsWith('#') ? hash : `#/${hash.replace(/^\//, '')}`;
  if (location.hash === target) renderCurrent();
  else location.hash = target;
}

function aiLabel() {
  const ai = data.health && data.health.ai;
  return ai && (ai.gemini || ai.openrouter) ? { on: true, text: 'KI aktiv' } : { on: false, text: 'KI aus · lokaler Parser' };
}

function buildNav() {
  const mk = () => h('nav', { class: 'nav', 'aria-label': 'Hauptnavigation' },
    ...ROUTES.map((r) => h('a', { href: `#/${r.id}`, dataset: { route: r.id } }, icon(r.icon), h('span', null, r.label))));
  const bottom = mk();
  const side = mk();
  navEls = [...bottom.querySelectorAll('a'), ...side.querySelectorAll('a')];
  return { bottom, side };
}

function aiBadge() {
  const { on, text } = aiLabel();
  return h('span', { class: ['ai-status', on && 'on'], title: 'Status der KI-Zutatenerkennung' }, text);
}

const logo = () => h('svg', { viewBox: '0 0 512 512', 'aria-hidden': 'true' },
  h('rect', { width: 512, height: 512, rx: 96, fill: '#2c5f48' }),
  h('path', { d: 'M126 250H386A130 130 0 0 1 126 250Z', fill: '#f7f1e5' }),
  h('path', { d: 'M196 190C176 150 216 130 206 90M256 190C236 150 276 130 266 90M316 190C296 150 336 130 326 90', fill: 'none', stroke: '#f7f1e5', 'stroke-width': 22, 'stroke-linecap': 'round' }));

function buildShell() {
  const { bottom, side } = buildNav();
  viewEl = h('main', { id: 'view', tabindex: '-1' });
  appEl.replaceChildren(
    h('aside', { class: 'sidebar' }, h('div', { class: 'brand' }, logo(), 'Makroküche'), side, aiBadge()),
    h('div', null,
      h('div', { class: 'topbar' }, h('div', { class: 'brand' }, logo(), 'Makroküche'), aiBadge()),
      viewEl),
    bottom);
}

function markActive(route) {
  for (const a of navEls) {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function errorCard(message) {
  return h('div', { class: 'page' },
    h('div', { class: 'card empty' },
      h('h2', null, 'Die App konnte nicht geladen werden.'),
      h('p', null, message || 'Die Daten konnten nicht geladen werden.'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, 'Neu laden')));
}

function makeCtx() {
  const targets = data.state && data.state.profile ? calcTargets(data.state.profile) : null;
  return { state: data.state, foods: data.foods, targets, api, navigate, refresh, toast };
}

async function renderCurrent() {
  if (!viewEl) return;
  let route = currentRoute();
  if (!route) {
    route = DEFAULT_ROUTE;
    history.replaceState(null, '', `#/${route}`);
  }
  if (!data.state.profile && route !== 'profil') {
    route = 'profil';
    history.replaceState(null, '', '#/profil');
  }
  markActive(route);
  const seq = ++renderSeq;
  const root = h('div', { class: 'view-root' });
  try {
    const mod = await import(`./views/${route}.js`);
    if (seq !== renderSeq) return;
    viewEl.replaceChildren(root);
    await mod.render(root, makeCtx());
    if (seq === renderSeq) window.scrollTo(0, 0);
  } catch (err) {
    if (seq !== renderSeq) return;
    viewEl.replaceChildren(errorCard(`Die Ansicht konnte nicht geladen werden: ${err.message}`));
  }
}

function updateAiStatus() {
  const { on, text } = aiLabel();
  for (const el of document.querySelectorAll('.ai-status')) {
    el.classList.toggle('on', on);
    el.textContent = text;
  }
}

async function refresh() {
  data.state = await api.getState();
  try {
    data.health = await api.health();
    updateAiStatus();
  } catch {
    // Scheitert die Abfrage, bleibt die KI-Anzeige unverändert.
  }
  await renderCurrent();
}

async function loadData() {
  const [state, foodsRes, health] = await Promise.all([
    api.getState(),
    fetch('data/foods.json').then((r) => {
      if (!r.ok) throw new Error('Lebensmitteltabelle konnte nicht geladen werden.');
      return r.json();
    }),
    api.health().catch(() => null),
  ]);
  data.state = state;
  data.foods = Array.isArray(foodsRes) ? foodsRes : (foodsRes.foods || []);
  data.health = health;
}

function registerSW() {
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!('serviceWorker' in navigator) || !secure) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function start() {
  try {
    await loadData();
  } catch (err) {
    appEl.style.display = 'block';
    appEl.replaceChildren(errorCard(err && err.message ? err.message : null));
    return;
  }
  buildShell();
  window.addEventListener('hashchange', renderCurrent);
  await renderCurrent();
  registerSW();
}

start();
