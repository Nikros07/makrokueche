// Rezepte: gespeicherte Rezepte mit Makros je Portion, Einkaufsliste, Bearbeiten und Löschen.
import { h, fill, fmt, emptyState, confirmDialog } from '../ui.js';
import { sumMacros, perPortion, ingredientMacros } from '../core/macros.js';
import { styleFit } from '../core/targets.js';

const DRAFT_KEY = 'makrokueche.draft';
const STYLES_HREF = 'css/views/rezepte.css';
const SEARCH_FROM = 6; // Suchfeld ab mehr als 5 Rezepten

// Gramm: unter 10 g eine Nachkommastelle, sonst ganze Zahlen.
function grams(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '–';
  return fmt(v, Math.abs(v) < 10 ? 1 : 0);
}

function ensureStyles() {
  const exists = [...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.getAttribute('href') === STYLES_HREF);
  if (!exists) document.head.appendChild(h('link', { rel: 'stylesheet', href: STYLES_HREF }));
}

function byNewest(a, b) {
  return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
}

export async function render(root, ctx) {
  ensureStyles();

  const recipes = [...(ctx.state.recipes || [])].sort(byNewest);
  const targets = ctx.targets || null;

  if (!recipes.length) {
    fill(root, 
      h('div', { class: 'page' },
        h('h1', { class: 'page-title' }, 'Rezepte'),
        emptyState('Noch keine Rezepte', 'Rechne im Makro-Rechner ein Gericht aus und speichere es als Rezept.',
          'Zum Rechner', () => ctx.navigate('#/rechner'))));
    return;
  }

  const perPortionOf = (r) => perPortion(sumMacros(r.ingredients), r.portions);
  const fitOf = (r) => (targets ? styleFit(perPortionOf(r), targets) : { fits: true, label: '' });

  let onlyFit = false;
  let search = null;
  const listBox = h('div', { class: 'stack' });

  function renderList() {
    const q = search ? search.value.trim().toLocaleLowerCase('de-DE') : '';
    const shown = recipes.filter((r) =>
      (!q || String(r.name ?? '').toLocaleLowerCase('de-DE').includes(q)) &&
      (!onlyFit || fitOf(r).fits));
    if (!shown.length) {
      fill(listBox, h('p', { class: 'muted' }, 'Kein Rezept passt zur Auswahl.'));
      return;
    }
    fill(listBox, ...shown.map(recipeCard));
  }

  function recipeCard(r) {
    const per = perPortionOf(r);
    const fit = targets ? fitOf(r) : null;
    const name = String(r.name ?? '');
    const count = (r.ingredients || []).length;

    async function addToShopping(btn) {
      const cur = ctx.state.shopping || { selections: [], manual: [], checked: {} };
      const selections = (cur.selections || []).map((s) => ({ ...s }));
      const hit = selections.find((s) => s.recipeId === r.id);
      if (hit) hit.portions = Number(hit.portions) + Number(r.portions);
      else selections.push({ recipeId: r.id, portions: r.portions });
      btn.disabled = true;
      try {
        await ctx.api.saveShopping({ ...cur, selections });
        ctx.toast('Auf der Einkaufsliste', 'ok');
        await ctx.refresh();
      } catch (err) {
        ctx.toast(err.message, 'error');
        btn.disabled = false;
      }
    }

    function editRecipe() {
      try {
        const draft = {
          recipeId: r.id,
          name: r.name,
          portions: r.portions,
          ingredients: structuredClone(r.ingredients || []),
        };
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch (err) {
        // Kein Speicher verfügbar: der Rechner startet dann ohne Entwurf.
      }
      ctx.navigate('#/rechner');
    }

    async function removeRecipe() {
      const yes = await confirmDialog(`Rezept „${name}“ löschen?`, 'Löschen');
      if (!yes) return;
      try {
        await ctx.api.deleteRecipe(r.id);
        ctx.toast('Rezept gelöscht.', 'ok');
        await ctx.refresh();
      } catch (err) {
        ctx.toast(err.message, 'error');
      }
    }

    const shopBtn = h('button', {
      class: 'btn btn-primary btn-small', type: 'button',
      'aria-label': `Auf die Einkaufsliste: „${name}“`,
      onclick: () => addToShopping(shopBtn),
    }, 'Auf die Einkaufsliste');

    const ingredientList = h('ul', { class: 'list' },
      (r.ingredients || []).map((ing) => h('li', { class: 'list-item rezept-zutat' },
        h('span', null,
          `${grams(ing.grams)} g ${String(ing.name ?? '')}`,
          ing.source === 'ai' ? ' ' : null,
          ing.source === 'ai' ? h('span', { class: 'badge badge-ai' }, 'KI-Schätzung') : null),
        h('span', { class: 'num' }, `${fmt(ingredientMacros(ing).kcal)} kcal`))));

    return h('article', { class: 'card stack' },
      h('div', null,
        h('h2', { class: 'card-title rezept-name' }, name),
        h('p', { class: 'muted' },
          `${fmt(r.portions)} ${Number(r.portions) === 1 ? 'Portion' : 'Portionen'} · ${count} ${count === 1 ? 'Zutat' : 'Zutaten'}`)),
      h('div', { class: 'row' },
        h('div', { class: 'kcal-big' }, h('strong', null, fmt(per.kcal)), h('span', null, 'kcal je Portion')),
        fit && fit.label ? h('span', { class: 'chip' }, fit.label) : null),
      h('p', { class: 'muted rezept-makros' },
        `E ${grams(per.protein)} g · F ${grams(per.fat)} g · KH ${grams(per.carbs)} g`),
      h('details', { class: 'rezept-details' },
        h('summary', null, 'Zutaten anzeigen'),
        ingredientList),
      h('div', { class: 'row rezept-aktionen' },
        shopBtn,
        h('button', {
          class: 'btn btn-ghost btn-small', type: 'button',
          'aria-label': `Bearbeiten: „${name}“`,
          onclick: editRecipe,
        }, 'Bearbeiten'),
        h('button', {
          class: 'btn btn-danger btn-small', type: 'button',
          'aria-label': `Löschen: „${name}“`,
          onclick: removeRecipe,
        }, 'Löschen')));
  }

  const controls = [];
  if (recipes.length >= SEARCH_FROM) {
    search = h('input', {
      class: 'input', type: 'search', placeholder: 'Rezept suchen',
      'aria-label': 'Rezepte nach Name suchen', autocomplete: 'off',
      oninput: renderList,
    });
    controls.push(search);
  }
  if (targets) {
    controls.push(h('label', { class: 'checkline' },
      h('input', {
        type: 'checkbox',
        onchange: (ev) => { onlyFit = ev.target.checked; renderList(); },
      }),
      h('span', null, 'Nur passend zu meinem Stil')));
  }

  fill(root, 
    h('div', { class: 'page' },
      h('h1', { class: 'page-title' }, 'Rezepte'),
      controls.length ? h('div', { class: 'row rezepte-kopf' }, controls) : null,
      listBox));

  renderList();
}
