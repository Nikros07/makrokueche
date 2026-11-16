// Einkaufsliste aus Rezepten.

import { normalize } from "./foodmatch.js";

export const CATEGORIES = [
  "fleisch", "fisch", "eier-milch", "gemuese", "obst", "nuesse-samen",
  "fette-oele", "getreide-beilagen", "huelsenfruechte", "gewuerze-sonstiges", "getraenke",
];

export const CATEGORY_LABELS = {
  fleisch: "Fleisch",
  fisch: "Fisch",
  "eier-milch": "Eier & Milchprodukte",
  gemuese: "Gemüse",
  obst: "Obst",
  "nuesse-samen": "Nüsse & Samen",
  "fette-oele": "Fette & Öle",
  "getreide-beilagen": "Getreide & Beilagen",
  huelsenfruechte: "Hülsenfrüchte",
  "gewuerze-sonstiges": "Gewürze & Sonstiges",
  getraenke: "Getränke",
};

const DEFAULT_CATEGORY = "gewuerze-sonstiges";

export function buildShoppingList(recipes, selections, foods) {
  const foodById = new Map((foods || []).map((f) => [f.id, f]));
  const recipeById = new Map((recipes || []).map((r) => [r.id, r]));
  const items = new Map();

  for (const sel of selections || []) {
    const recipe = recipeById.get(sel && sel.recipeId);
    const wanted = Number(sel && sel.portions);
    if (!recipe || !Number.isFinite(wanted) || wanted <= 0) continue;
    const base = Number(recipe.portions);
    const factor = wanted / (Number.isFinite(base) && base >= 1 ? base : 1);

    for (const ing of recipe.ingredients || []) {
      const grams = Number(ing && ing.grams);
      if (!Number.isFinite(grams) || grams <= 0) continue;
      const key = ing.foodId ? ing.foodId : "x:" + normalize(ing.name);
      let item = items.get(key);
      if (!item) {
        const food = ing.foodId ? foodById.get(ing.foodId) : null;
        item = {
          key,
          name: String(ing.name ?? ""),
          grams: 0,
          category: food && CATEGORIES.includes(food.category) ? food.category : DEFAULT_CATEGORY,
          fromRecipes: [],
        };
        items.set(key, item);
      }
      item.grams += grams * factor;
      if (!item.fromRecipes.includes(recipe.name)) item.fromRecipes.push(recipe.name);
    }
  }

  return [...items.values()]
    .map((it) => ({ ...it, grams: Math.round(it.grams * 10) / 10 }))
    .sort(
      (a, b) =>
        CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
        a.name.localeCompare(b.name, "de"),
    );
}

const nf = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const nfInt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

export function formatAmount(grams, food) {
  const g = Number.isFinite(Number(grams)) ? Math.max(0, Number(grams)) : 0;
  const rounded = g < 10 ? Math.round(g * 10) / 10 : Math.round(g);
  const text = rounded >= 1000 ? `${nf.format(rounded / 1000)} kg` : `${nf.format(rounded)} g`;
  const piece = food && food.units && Number(food.units.stueck);
  // Stückangabe nur, wenn es mindestens etwa ein ganzes Stück ist (28 g Butter sind kein "1 Stück").
  if (piece > 0 && g / piece >= 0.75) {
    return `${text} (≈ ${nfInt.format(Math.round(g / piece))} Stück)`;
  }
  return text;
}
