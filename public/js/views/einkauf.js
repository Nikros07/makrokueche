// Einkaufsliste: Rezepte mit Portionen, berechnete Liste zum Abhaken, eigene Einträge.
import { h, fill, fmt, emptyState, confirmDialog, field } from '../ui.js';
import { buildShoppingList, formatAmount, CATEGORY_LABELS } from '../core/shopping.js';

const MAX_PORTIONS = 50;
const MAX_MANUAL = 200;
const MAX_TEXT = 200;

export async function render(root, ctx) {
  const recipes = ctx.state.recipes || [];
  const foods = ctx.foods || [];
  const foodById = new Map(foods.map((f) => [f.id, f]));

  // Arbeitskopie; ctx.state bleibt unverändert.
  const shop = structuredClone(ctx.state.shopping || {});
  if (!Array.isArray(shop.selections)) shop.selections = [];
  if (!Array.isArray(shop.manual)) shop.manual = [];
  if (!shop.checked || typeof shop.checked !== 'object') shop.checked = {};

  let currentList = [];

  // Auswahl-Einträge ohne vorhandenes Rezept werden ignoriert (und beim Speichern entfernt).
  function liveSelections() {
    return shop.selections.filter((s) => s && recipes.some((r) => r.id === s.recipeId));
  }
  function recipeOf(id) {
    return recipes.find((r) => r.id === id);
  }

  // Speichern nacheinander, damit sich schnelle Klicks nicht überholen.
  let queue = Promise.resolve();
  function save() {
    queue = queue.then(async () => {
      shop.selections = liveSelections();
      try {
        await ctx.api.saveShopping(structuredClone(shop));
      } catch (err) {
        ctx.toast(err.message, 'error');
        ctx.refresh();
      }
    });
    return queue;
  }

  // ---------- Statische Teile ----------
  const topSlot = h('div', { class: 'stack' });
  const recipesSlot = h('div', { class: 'stack' });
  const shoppingSlot = h('div', { class: 'stack' });
  const manualList = h('div');
  const countEl = h('p', { class: 'muted', 'aria-live': 'polite' });

  const manualInput = h('input', {
    class: 'input', type: 'text', maxlength: MAX_TEXT, placeholder: 'z. B. Küchenrolle', autocomplete: 'off',
  });
  const manualForm = h('form', { class: 'row nowrap', style: { alignItems: 'flex-end' }, onsubmit: onAddManual },
    h('div', { style: { flex: '1', minWidth: '0' } }, field('Eigener Eintrag', manualInput)),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Hinzufügen'));

  const manualCard = h('section', { class: 'card stack', 'aria-labelledby': 'einkauf-manual-title' },
    h('h2', { class: 'card-title', id: 'einkauf-manual-title' }, 'Eigene Einträge'),
    manualForm,
    manualList);

  const actionsRow = h('div', { class: 'row' },
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: onCopy }, 'Liste kopieren'),
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: onResetChecks }, 'Haken zurücksetzen'),
    h('button', { class: 'btn btn-danger', type: 'button', onclick: onClearAll }, 'Liste leeren'));

  fill(root, 
    h('div', { class: 'page' },
      h('h1', { class: 'page-title' }, 'Einkaufsliste'),
      topSlot,
      recipesSlot,
      shoppingSlot,
      manualCard,
      actionsRow));

  draw();

  // ---------- Zeichnen ----------
  function draw() {
    const sels = liveSelections();
    const isEmpty = sels.length === 0 && shop.manual.length === 0;

    fill(topSlot, isEmpty
      ? emptyState(
        'Die Einkaufsliste ist leer',
        'Füge in der Rezepte-Ansicht ein Rezept hinzu oder schreib unten einen eigenen Eintrag auf.',
        'Zu den Rezepten',
        () => ctx.navigate('#/rezepte'))
      : null);

    fill(recipesSlot, isEmpty ? null : recipesCard(sels));

    currentList = buildShoppingList(recipes, sels, foods);
    fill(shoppingSlot, isEmpty ? null : shoppingCard(currentList));

    fill(manualList, manualItems());
    drawCount();
  }

  function recipesCard(sels) {
    const list = h('ul', { class: 'list' });
    if (!sels.length) {
      fill(list);
    }
    for (const sel of sels) {
      const recipe = recipeOf(sel.recipeId);
      const name = recipe ? recipe.name : '';
      const input = h('input', {
        class: 'input', type: 'number', inputmode: 'numeric', min: 1, max: MAX_PORTIONS, step: 1,
        value: String(sel.portions), 'aria-label': `Portionen für ${name}`,
        onchange: () => onPortionsChange(sel, input),
      });
      list.appendChild(h('li', { class: 'list-item' },
        h('div', { class: ['row', 'between', 'nowrap'] },
          h('strong', null, name),
          h('button', {
            class: 'btn btn-ghost btn-small', type: 'button', 'aria-label': `${name} von der Liste nehmen`,
            onclick: () => onRemoveSelection(sel),
          }, 'Entfernen')),
        field('Portionen', input)));
    }
    return h('section', { class: 'card stack', 'aria-labelledby': 'einkauf-recipes-title' },
      h('h2', { class: 'card-title', id: 'einkauf-recipes-title' }, 'Rezepte auf der Liste'),
      sels.length ? list : h('p', { class: 'muted' }, 'Noch kein Rezept ausgewählt.'));
  }

  function shoppingCard(items) {
    const body = [];
    if (!items.length) {
      body.push(h('p', { class: 'muted' }, 'Keine Zutaten in den gewählten Rezepten.'));
    } else {
      let lastCat = null;
      let ul = null;
      for (const it of items) {
        if (it.category !== lastCat) {
          lastCat = it.category;
          body.push(h('h3', { class: 'card-title' }, CATEGORY_LABELS[it.category] || it.category));
          ul = h('ul', { class: 'list' });
          body.push(ul);
        }
        const food = foodById.get(it.key);
        const checkbox = h('input', {
          type: 'checkbox',
          checked: shop.checked[it.key] === true,
          onchange: (ev) => onToggleItem(it.key, ev.target.checked),
        });
        ul.appendChild(h('li', { class: 'list-item' },
          h('label', { class: 'checkline' },
            checkbox,
            h('span', null,
              h('span', null, it.name),
              ' ',
              h('span', { class: 'muted' }, formatAmount(it.grams, food)),
              it.fromRecipes && it.fromRecipes.length
                ? h('small', { class: 'muted', style: { display: 'block' } }, `für: ${it.fromRecipes.join(', ')}`)
                : null))));
      }
    }
    return h('section', { class: 'card stack', 'aria-labelledby': 'einkauf-shop-title' },
      h('h2', { class: 'card-title', id: 'einkauf-shop-title' }, 'Einkaufen'),
      items.length ? countEl : null,
      body);
  }

  function manualItems() {
    if (!shop.manual.length) return h('p', { class: 'muted' }, 'Noch keine eigenen Einträge.');
    const ul = h('ul', { class: 'list' });
    for (const entry of shop.manual) {
      const checkbox = h('input', {
        type: 'checkbox',
        checked: entry.checked === true,
        onchange: (ev) => onToggleManual(entry, ev.target.checked),
      });
      ul.appendChild(h('li', { class: 'list-item' },
        h('div', { class: ['row', 'between', 'nowrap'] },
          h('label', { class: 'checkline', style: { flex: '1', minWidth: '0' } },
            checkbox,
            h('span', null, entry.text)),
          h('button', {
            class: 'btn btn-ghost btn-small', type: 'button', 'aria-label': `${entry.text} entfernen`,
            onclick: () => onRemoveManual(entry),
          }, 'Entfernen'))));
    }
    return ul;
  }

  // Nur die Zählzeile; die Checkboxen behalten ihren Zustand (Fokus bleibt).
  function drawCount() {
    if (!currentList.length) return;
    const done = currentList.filter((it) => shop.checked[it.key] === true).length;
    countEl.textContent = `${fmt(done)} von ${fmt(currentList.length)} erledigt`;
  }

  // ---------- Aktionen ----------
  function onPortionsChange(sel, input) {
    const raw = input.value.trim().replace(',', '.');
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < 1 || n > MAX_PORTIONS) {
      input.value = String(sel.portions);
      return;
    }
    if (n === sel.portions) return;
    sel.portions = n;
    draw();
    save();
  }

  function onRemoveSelection(sel) {
    shop.selections = shop.selections.filter((s) => s !== sel);
    draw();
    save();
  }

  function onToggleItem(key, checked) {
    if (checked) shop.checked[key] = true;
    else delete shop.checked[key];
    drawCount();
    save();
  }

  function onToggleManual(entry, checked) {
    entry.checked = checked;
    save();
  }

  function onAddManual(ev) {
    ev.preventDefault();
    const text = manualInput.value.trim();
    if (!text) return;
    if (shop.manual.length >= MAX_MANUAL) {
      ctx.toast(`Höchstens ${MAX_MANUAL} eigene Einträge.`, 'warn');
      return;
    }
    shop.manual.push({ id: crypto.randomUUID(), text: text.slice(0, MAX_TEXT), checked: false });
    manualInput.value = '';
    draw();
    manualInput.focus();
    save();
  }

  function onRemoveManual(entry) {
    shop.manual = shop.manual.filter((e) => e !== entry);
    draw();
    save();
  }

  function onResetChecks() {
    shop.checked = {};
    for (const e of shop.manual) e.checked = false;
    draw();
    save();
  }

  async function onClearAll() {
    const ok = await confirmDialog('Die ganze Einkaufsliste leeren?', 'Leeren');
    if (!ok) return;
    shop.selections = [];
    shop.manual = [];
    shop.checked = {};
    draw();
    save();
  }

  async function onCopy() {
    const lines = [];
    let lastCat = null;
    for (const it of currentList) {
      if (shop.checked[it.key] === true) continue;
      if (it.category !== lastCat) {
        if (lastCat !== null) lines.push('');
        lastCat = it.category;
        lines.push(CATEGORY_LABELS[it.category] || it.category);
      }
      lines.push(`- ${it.name} (${formatAmount(it.grams, foodById.get(it.key))})`);
    }
    const openManual = shop.manual.filter((e) => e.checked !== true);
    if (openManual.length) {
      if (lines.length) lines.push('');
      lines.push('Eigene Einträge');
      for (const e of openManual) lines.push(`- ${e.text}`);
    }
    const text = lines.join('\n') + '\n';
    try {
      await navigator.clipboard.writeText(text);
      ctx.toast('Liste kopiert', 'ok');
    } catch {
      ctx.toast('Kopieren nicht möglich', 'warn');
    }
  }
}
