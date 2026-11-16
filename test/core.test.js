import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  round1, atwaterKcal, checkPer100, ingredientMacros, sumMacros, perPortion, macroPercents,
} from "../public/js/core/macros.js";
import {
  normalize, findFood, searchFoods, parseLine, toGrams, splitIngredients, parseIngredientsLocal,
} from "../public/js/core/foodmatch.js";
import { STYLES, calcTargets, styleFit } from "../public/js/core/targets.js";
import { buildShoppingList, formatAmount, CATEGORIES, CATEGORY_LABELS } from "../public/js/core/shopping.js";
import { sortEntries, movingAverage, weightStats } from "../public/js/core/weight.js";

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `erwartet ${expected}, erhalten ${actual}`);

const deepFreeze = (o) => {
  Object.values(o).forEach((v) => typeof v === "object" && v !== null && deepFreeze(v));
  return Object.freeze(o);
};

// ---------------------------------------------------------------- macros

describe("macros", () => {
  const hack = { name: "Rinderhack", grams: 200, per100: { kcal: 250, protein: 20, fat: 19, carbs: 0, fiber: 0 } };
  const butter = { name: "Butter", grams: 10, per100: { kcal: 740, protein: 0.7, fat: 82, carbs: 0.6, fiber: 0 } };

  test("round1 und atwaterKcal", () => {
    assert.equal(round1(2.449), 2.4);
    assert.equal(round1(2.45), 2.5);
    assert.equal(round1(NaN), 0);
    assert.equal(round1(undefined), 0);
    assert.equal(atwaterKcal({ protein: 10, carbs: 20, fat: 5, fiber: 3 }), 40 + 80 + 45 + 6);
    assert.equal(atwaterKcal({}), 0);
    assert.equal(atwaterKcal(null), 0);
  });

  test("ingredientMacros rechnet nach Gramm", () => {
    const m = ingredientMacros(hack);
    assert.deepEqual(m, { kcal: 500, protein: 40, fat: 38, carbs: 0, fiber: 0 });
  });

  test("ingredientMacros: fehlende und NaN-Werte werden 0", () => {
    assert.deepEqual(ingredientMacros({ grams: NaN, per100: hack.per100 }), { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 });
    assert.deepEqual(ingredientMacros({ grams: 100 }), { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 });
    const m = ingredientMacros({ grams: 100, per100: { kcal: NaN, protein: 5 } });
    assert.equal(m.kcal, 0);
    assert.equal(m.protein, 5);
    assert.deepEqual(ingredientMacros(null), { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 });
  });

  test("sumMacros summiert von Hand nachgerechnet", () => {
    const total = sumMacros([hack, butter]);
    close(total.kcal, 500 + 74);
    close(total.protein, 40 + 0.07);
    close(total.fat, 38 + 8.2);
    close(total.carbs, 0.06);
    close(total.fiber, 0);
    assert.deepEqual(sumMacros([]), { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 });
    assert.deepEqual(sumMacros(undefined), { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 });
  });

  test("Eingaben werden nicht verändert", () => {
    const input = deepFreeze([structuredClone(hack), structuredClone(butter)]);
    assert.doesNotThrow(() => sumMacros(input));
    assert.doesNotThrow(() => checkPer100(deepFreeze({ kcal: 500, protein: 10, fat: 10, carbs: 10, fiber: 0 })));
  });

  test("perPortion teilt, portions < 1 wie 1", () => {
    const total = { kcal: 800, protein: 40, fat: 20, carbs: 100, fiber: 8 };
    assert.deepEqual(perPortion(total, 4), { kcal: 200, protein: 10, fat: 5, carbs: 25, fiber: 2 });
    assert.deepEqual(perPortion(total, 1), total);
    assert.deepEqual(perPortion(total, 0), total);
    assert.deepEqual(perPortion(total, 0.5), total);
    assert.deepEqual(perPortion(total, -3), total);
    assert.deepEqual(perPortion(total, NaN), total);
    assert.deepEqual(perPortion(null, 2), { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 });
  });

  test("macroPercents: Summe ≈ 100, 0-kcal-Fall", () => {
    // 25 g Eiweiß = 100 kcal, 10 g Fett = 90 kcal, 25 g KH = 100 kcal → 290 kcal
    const p = macroPercents({ protein: 25, fat: 10, carbs: 25 });
    close(p.protein, 34.5, 0.05);
    close(p.fat, 31, 0.05);
    close(p.carbs, 34.5, 0.05);
    close(p.protein + p.fat + p.carbs, 100, 0.2);
    assert.deepEqual(macroPercents({ kcal: 0, protein: 0, fat: 0, carbs: 0 }), { protein: 0, fat: 0, carbs: 0 });
    assert.deepEqual(macroPercents({}), { protein: 0, fat: 0, carbs: 0 });
    assert.deepEqual(macroPercents(null), { protein: 0, fat: 0, carbs: 0 });
    const only = macroPercents({ protein: 0, fat: 10, carbs: 0 });
    assert.equal(only.fat, 100);
  });

  test("checkPer100: gültige Werte", () => {
    // Hähnchenbrust: Atwater = 92 + 13,5 = 105,5, Abweichung 4,5
    const r = checkPer100({ kcal: 110, protein: 23, fat: 1.5, carbs: 0, fiber: 0 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.fixed, { kcal: 110, protein: 23, fat: 1.5, carbs: 0, fiber: 0 });
  });

  test("checkPer100: Toleranz max(25, 20 %)", () => {
    // Atwater 40 → Toleranz 25: 65 ok, 66 nicht
    assert.equal(checkPer100({ kcal: 65, protein: 10, fat: 0, carbs: 0, fiber: 0 }).ok, true);
    assert.equal(checkPer100({ kcal: 66, protein: 10, fat: 0, carbs: 0, fiber: 0 }).ok, false);
    // Atwater 400 → Toleranz 80: 480 ok, 481 nicht
    assert.equal(checkPer100({ kcal: 480, protein: 100, fat: 0, carbs: 0, fiber: 0 }).ok, true);
    assert.equal(checkPer100({ kcal: 481, protein: 100, fat: 0, carbs: 0, fiber: 0 }).ok, false);
  });

  test("checkPer100: kcal-Korrektur auf gerundeten Atwater-Wert", () => {
    const r = checkPer100({ kcal: 500, protein: 10, fat: 10, carbs: 10.2, fiber: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.problems.length, 1);
    assert.equal(r.fixed.kcal, Math.round(40 + 40.8 + 90));
    assert.equal(r.fixed.protein, 10);
    assert.equal(r.fixed.carbs, 10.2);
  });

  test("checkPer100: negative Werte", () => {
    const r = checkPer100({ kcal: 100, protein: -5, fat: 2, carbs: 10, fiber: 0 });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((s) => /negativ/.test(s)));
    assert.equal(r.fixed.protein, 0);
    const neg = checkPer100({ kcal: -10, protein: 0, fat: 0, carbs: 0, fiber: 0 });
    assert.equal(neg.ok, false);
    assert.equal(neg.fixed.kcal, 0);
  });

  test("checkPer100: Makro über 100, kcal über 900", () => {
    const a = checkPer100({ kcal: 900, protein: 0, fat: 101, carbs: 0, fiber: 0 });
    assert.equal(a.ok, false);
    assert.ok(a.fixed.fat <= 100);
    const b = checkPer100({ kcal: 950, protein: 0, fat: 100, carbs: 0, fiber: 0 });
    assert.equal(b.ok, false);
    assert.ok(b.fixed.kcal <= 900);
  });

  test("checkPer100: Summe der Makros über 102", () => {
    // 50+50+10 = 110, kcal passend zu Atwater (200 + 450 + 40 = 690)
    const r = checkPer100({ kcal: 690, protein: 50, fat: 50, carbs: 10, fiber: 0 });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((s) => /zusammen/.test(s)));
    // Genau 102 ist erlaubt
    const edge = checkPer100({ kcal: 4 * 52 + 9 * 50, protein: 52, fat: 50, carbs: 0, fiber: 0 });
    assert.equal(edge.ok, true);
  });

  test("checkPer100: fehlende Werte und NaN", () => {
    const r = checkPer100({ kcal: NaN, protein: "x" });
    assert.deepEqual(r.fixed, { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 });
    assert.equal(r.ok, true);
    assert.equal(checkPer100(undefined).ok, true);
  });
});

// ------------------------------------------------------------- foodmatch

const FOODS = [
  { id: "rinderhack", name: "Rinderhackfleisch", aliases: ["Rinderhack", "Hackfleisch vom Rind"], category: "fleisch",
    per100: { kcal: 250, protein: 20, fat: 19, carbs: 0, fiber: 0 } },
  { id: "ei", name: "Ei", aliases: ["Hühnerei"], category: "eier-milch",
    per100: { kcal: 137, protein: 12.5, fat: 9.3, carbs: 0.5, fiber: 0 }, units: { stueck: 60 } },
  { id: "eisbergsalat", name: "Eisbergsalat", aliases: [], category: "gemuese",
    per100: { kcal: 14, protein: 0.9, fat: 0.2, carbs: 1.8, fiber: 1.2 } },
  { id: "butter", name: "Butter", aliases: [], category: "fette-oele",
    per100: { kcal: 740, protein: 0.7, fat: 82, carbs: 0.6, fiber: 0 }, units: { el: 14, tl: 5 } },
  { id: "erdnussbutter", name: "Erdnussbutter", aliases: [], category: "nuesse-samen",
    per100: { kcal: 600, protein: 25, fat: 50, carbs: 10, fiber: 6 } },
  { id: "reis", name: "Reis", aliases: [], category: "getreide-beilagen",
    per100: { kcal: 350, protein: 7, fat: 1, carbs: 77, fiber: 1 }, units: { tasse: 180 } },
  { id: "preiselbeere", name: "Preiselbeere", aliases: [], category: "obst",
    per100: { kcal: 46, protein: 0.4, fat: 0.5, carbs: 8, fiber: 3 } },
  { id: "tomate", name: "Tomate", aliases: [], category: "gemuese",
    per100: { kcal: 18, protein: 0.9, fat: 0.2, carbs: 2.6, fiber: 1.2 }, units: { stueck: 100 } },
  { id: "tomatenmark", name: "Tomatenmark", aliases: [], category: "gewuerze-sonstiges",
    per100: { kcal: 80, protein: 4, fat: 0.5, carbs: 13, fiber: 4 } },
  { id: "zwiebel", name: "Zwiebel", aliases: ["rote Zwiebel"], category: "gemuese",
    per100: { kcal: 40, protein: 1.1, fat: 0.1, carbs: 7, fiber: 1.7 }, units: { stueck: 80 } },
  { id: "avocado", name: "Avocado", aliases: [], category: "obst",
    per100: { kcal: 160, protein: 2, fat: 15, carbs: 2, fiber: 6.7 }, units: { stueck: 150 } },
  { id: "milch", name: "Vollmilch", aliases: ["Milch"], category: "eier-milch",
    per100: { kcal: 65, protein: 3.4, fat: 3.6, carbs: 4.8, fiber: 0 }, units: { ml: 1.03 } },
  { id: "milch-lf", name: "Milch laktosefrei", aliases: ["Milch"], category: "eier-milch",
    per100: { kcal: 65, protein: 3.4, fat: 3.6, carbs: 4.8, fiber: 0 } },
  { id: "thunfisch", name: "Thunfisch in Wasser", aliases: [], category: "fisch",
    per100: { kcal: 110, protein: 25, fat: 1, carbs: 0, fiber: 0 }, units: { dose: 120 } },
  { id: "knoblauch", name: "Knoblauch", aliases: [], category: "gemuese",
    per100: { kcal: 140, protein: 6, fat: 0.1, carbs: 28, fiber: 2 }, units: { zehe: 5 } },
  { id: "salz", name: "Salz", aliases: [], category: "gewuerze-sonstiges",
    per100: { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }, units: { prise: 0.4, tl: 6 } },
  { id: "olivenoel", name: "Olivenöl", aliases: [], category: "fette-oele",
    per100: { kcal: 880, protein: 0, fat: 100, carbs: 0, fiber: 0 }, units: { el: 9, ml: 0.91 } },
];

const ids = (list) => list.map((f) => f.id);
const without = (...drop) => FOODS.filter((f) => !drop.includes(f.id));

describe("foodmatch: normalize", () => {
  test("Umlaute, ß, Akzente, Satzzeichen, Leerzeichen", () => {
    assert.equal(normalize("Äpfel & Öl, Süßes!"), "aepfel oel suesses");
    assert.equal(normalize("  Crème   fraîche "), "creme fraiche");
    assert.equal(normalize("Spaß-Käse (30 %)"), "spass kaese 30");
    assert.equal(normalize("HÜHNERBRUST"), "huehnerbrust");
    assert.equal(normalize(""), "");
    assert.equal(normalize(null), "");
    assert.equal(normalize(undefined), "");
    assert.equal(normalize("***"), "");
  });
});

describe("foodmatch: findFood", () => {
  test("exakt über Name und Alias", () => {
    assert.equal(findFood("Rinderhackfleisch", FOODS).id, "rinderhack");
    assert.equal(findFood("rinderhack", FOODS).id, "rinderhack");
    assert.equal(findFood("Hackfleisch vom Rind", FOODS).id, "rinderhack");
    assert.equal(findFood("hühnerei", FOODS).id, "ei");
    assert.equal(findFood("Huehnerei", FOODS).id, "ei");
  });

  test("Fallen: Butter/Erdnussbutter, Reis/Preiselbeere, Ei/Eisbergsalat", () => {
    assert.equal(findFood("Butter", FOODS).id, "butter");
    assert.equal(findFood("Butter", without("butter")), null);
    assert.equal(findFood("Reis", FOODS).id, "reis");
    assert.equal(findFood("Reis", without("reis")), null);
    assert.equal(findFood("Ei", FOODS).id, "ei");
    assert.equal(findFood("Ei", without("ei")), null);
    assert.equal(findFood("Eis", FOODS), null);
    assert.equal(findFood("Tomate", without("tomate")), null);
  });

  test("Plural-Toleranz", () => {
    assert.equal(findFood("Eier", FOODS).id, "ei");
    assert.equal(findFood("Tomaten", FOODS).id, "tomate");
    assert.equal(findFood("Zwiebeln", FOODS).id, "zwiebel");
    assert.equal(findFood("Avocados", FOODS).id, "avocado");
    assert.equal(findFood("Zehen", [{ id: "z", name: "Zehe", aliases: [] }]).id, "z");
  });

  test("Wortanfang: Suchbegriff beginnt mit Kandidat oder umgekehrt", () => {
    assert.equal(findFood("Olivenöl nativ extra", FOODS).id, "olivenoel");
    assert.equal(findFood("Milch laktosefrei", FOODS).id, "milch-lf");
    assert.equal(findFood("Thunfisch", FOODS).id, "thunfisch");
  });

  test("alle Wörter des Suchbegriffs kommen vor", () => {
    assert.equal(findFood("Thunfisch Wasser", FOODS).id, "thunfisch");
    assert.equal(findFood("wasser thunfisch", FOODS).id, "thunfisch");
    // Einzelwort "Wasser" darf nicht jedes "… in Wasser" treffen
    assert.equal(findFood("Wasser", FOODS), null);
  });

  test("mehrere gleich gute Treffer: kürzester Name", () => {
    assert.equal(findFood("Milch", FOODS).id, "milch"); // "Vollmilch" (9) vor "Milch laktosefrei" (17)
    const list = [
      { id: "lang", name: "Käse, gerieben, würzig", aliases: ["Käse"] },
      { id: "kurz", name: "Käse mild", aliases: ["Käse"] },
    ];
    assert.equal(findFood("Käse", list).id, "kurz");
  });

  test("kein Treffer, zu kurz, ungültige Eingaben", () => {
    assert.equal(findFood("Dinkelmehl", FOODS), null);
    assert.equal(findFood("x", FOODS), null);
    assert.equal(findFood("", FOODS), null);
    assert.equal(findFood("  ", FOODS), null);
    assert.equal(findFood(null, FOODS), null);
    assert.equal(findFood("Reis", []), null);
    assert.equal(findFood("Reis", null), null);
  });
});

describe("foodmatch: searchFoods", () => {
  test("Reihenfolge und Limit", () => {
    const r = searchFoods("tom", FOODS);
    assert.deepEqual(ids(r), ["tomate", "tomatenmark"]);
    assert.equal(searchFoods("e", FOODS, 3).length, 3);
    assert.deepEqual(ids(searchFoods("Butter", FOODS)), ["butter", "erdnussbutter"]);
    assert.deepEqual(searchFoods("", FOODS), []);
    assert.deepEqual(searchFoods("zzz", FOODS), []);
  });
});

describe("foodmatch: parseLine", () => {
  const cases = [
    ["200 g Rinderhack", { amount: 200, unit: "g", name: "Rinderhack" }],
    ["200g Rinderhack", { amount: 200, unit: "g", name: "Rinderhack" }],
    ["200 gr Rinderhack", { amount: 200, unit: "g", name: "Rinderhack" }],
    ["300 Gramm Reis", { amount: 300, unit: "g", name: "Reis" }],
    ["1,5 kg Mehl", { amount: 1.5, unit: "kg", name: "Mehl" }],
    ["1.5 kg Mehl", { amount: 1.5, unit: "kg", name: "Mehl" }],
    ["250 ml Wasser", { amount: 250, unit: "ml", name: "Wasser" }],
    ["1,5 l Milch", { amount: 1.5, unit: "l", name: "Milch" }],
    ["2 Liter Wasser", { amount: 2, unit: "l", name: "Wasser" }],
    ["2 Eier", { amount: 2, unit: null, name: "Eier" }],
    ["1 EL Butter", { amount: 1, unit: "el", name: "Butter" }],
    ["1 EL. Butter", { amount: 1, unit: "el", name: "Butter" }],
    ["4 Esslöffel Olivenöl", { amount: 4, unit: "el", name: "Olivenöl" }],
    ["2 TL Zimt", { amount: 2, unit: "tl", name: "Zimt" }],
    ["2 Teelöffel Zimt", { amount: 2, unit: "tl", name: "Zimt" }],
    ["1/2 Avocado", { amount: 0.5, unit: null, name: "Avocado" }],
    ["1 1/2 TL Salz", { amount: 1.5, unit: "tl", name: "Salz" }],
    ["3/4 l Milch", { amount: 0.75, unit: "l", name: "Milch" }],
    ["eine Prise Salz", { amount: 1, unit: "prise", name: "Salz" }],
    ["2 Prisen Salz", { amount: 2, unit: "prise", name: "Salz" }],
    ["ein Ei", { amount: 1, unit: null, name: "Ei" }],
    ["einen Apfel", { amount: 1, unit: null, name: "Apfel" }],
    ["zwei Scheiben Käse", { amount: 2, unit: "scheibe", name: "Käse" }],
    ["drei Eier", { amount: 3, unit: null, name: "Eier" }],
    ["halbe Avocado", { amount: 0.5, unit: null, name: "Avocado" }],
    ["eine halbe Avocado", { amount: 0.5, unit: null, name: "Avocado" }],
    ["halber Becher Joghurt", { amount: 0.5, unit: "becher", name: "Joghurt" }],
    ["3 Zehen Knoblauch", { amount: 3, unit: "zehe", name: "Knoblauch" }],
    ["1 Zehe Knoblauch", { amount: 1, unit: "zehe", name: "Knoblauch" }],
    ["1 Bund Petersilie", { amount: 1, unit: "bund", name: "Petersilie" }],
    ["2 Dosen Thunfisch", { amount: 2, unit: "dose", name: "Thunfisch" }],
    ["1 Handvoll Nüsse", { amount: 1, unit: "handvoll", name: "Nüsse" }],
    ["2 Stück Ei", { amount: 2, unit: "stueck", name: "Ei" }],
    ["2 Stk Ei", { amount: 2, unit: "stueck", name: "Ei" }],
    ["2 Stk. Ei", { amount: 2, unit: "stueck", name: "Ei" }],
    ["1 St. Ei", { amount: 1, unit: "stueck", name: "Ei" }],
    ["1 Becher Joghurt", { amount: 1, unit: "becher", name: "Joghurt" }],
    ["2 Tassen Kaffee", { amount: 2, unit: "tasse", name: "Kaffee" }],
    ["Butter", { amount: 1, unit: null, name: "Butter" }],
    ["Rinderhack 200 g", { amount: 200, unit: "g", name: "Rinderhack" }],
    ["Rinderhack 200g", { amount: 200, unit: "g", name: "Rinderhack" }],
    ["Käse 2 Scheiben", { amount: 2, unit: "scheibe", name: "Käse" }],
    ["  200   g   Rinderhack  ", { amount: 200, unit: "g", name: "Rinderhack" }],
    ["ca. 200 g Rinderhack", { amount: 200, unit: "g", name: "Rinderhack" }],
    ["200 g von Rinderhack", { amount: 200, unit: "g", name: "Rinderhack" }],
    ["100 g Gurke", { amount: 100, unit: "g", name: "Gurke" }],
    ["Mehl Type 405", { amount: 1, unit: null, name: "Mehl Type 405" }],
    ["1 Ei", { amount: 1, unit: null, name: "Ei" }],
  ];
  for (const [input, expected] of cases) {
    test(JSON.stringify(input), () => assert.deepEqual(parseLine(input), expected));
  }

  test("leere Eingaben", () => {
    assert.deepEqual(parseLine(""), { amount: 1, unit: null, name: "" });
    assert.deepEqual(parseLine(null), { amount: 1, unit: null, name: "" });
  });

  test("Einheit allein ohne Namen", () => {
    assert.deepEqual(parseLine("200 g"), { amount: 200, unit: "g", name: "" });
  });
});

describe("foodmatch: toGrams", () => {
  const ei = FOODS.find((f) => f.id === "ei");
  const milch = FOODS.find((f) => f.id === "milch");
  const butter = FOODS.find((f) => f.id === "butter");
  const hack = FOODS.find((f) => f.id === "rinderhack");

  test("g und kg direkt", () => {
    assert.equal(toGrams({ amount: 200, unit: "g" }, hack), 200);
    assert.equal(toGrams({ amount: 1.5, unit: "kg" }, hack), 1500);
  });
  test("ml und l über units.ml oder 1 g/ml", () => {
    assert.equal(toGrams({ amount: 250, unit: "ml" }, milch), 257.5);
    assert.equal(toGrams({ amount: 1, unit: "l" }, milch), 1030);
    assert.equal(toGrams({ amount: 250, unit: "ml" }, hack), 250);
    assert.equal(toGrams({ amount: 1.5, unit: "l" }, hack), 1500);
  });
  test("Haushaltseinheiten über food.units", () => {
    assert.equal(toGrams({ amount: 1, unit: "el" }, butter), 14);
    assert.equal(toGrams({ amount: 2, unit: "tl" }, butter), 10);
    assert.equal(toGrams({ amount: 1, unit: "stueck" }, ei), 60);
  });
  test("ohne Einheit: units.stueck", () => {
    assert.equal(toGrams({ amount: 2, unit: null }, ei), 120);
    assert.equal(toGrams({ amount: 0.5, unit: null }, FOODS.find((f) => f.id === "avocado")), 75);
  });
  test("nicht bestimmbar → null", () => {
    assert.equal(toGrams({ amount: 1, unit: null }, hack), null);
    assert.equal(toGrams({ amount: 1, unit: "el" }, hack), null);
    assert.equal(toGrams({ amount: 1, unit: "bund" }, ei), null);
    assert.equal(toGrams({ amount: NaN, unit: "g" }, hack), null);
    assert.equal(toGrams({ amount: 0, unit: "g" }, hack), null);
    assert.equal(toGrams({ amount: -2, unit: "g" }, hack), null);
    assert.equal(toGrams(null, hack), null);
  });
});

describe("foodmatch: splitIngredients", () => {
  test("Trenner", () => {
    assert.deepEqual(
      splitIngredients("200 g Rinderhack, 2 Eier und 1 EL Butter\n1/2 Avocado; Salz"),
      ["200 g Rinderhack", "2 Eier", "1 EL Butter", "1/2 Avocado", "Salz"],
    );
  });
  test("Dezimalkomma bleibt erhalten", () => {
    assert.deepEqual(splitIngredients("1,5 l Milch, 2,5 kg Mehl"), ["1,5 l Milch", "2,5 kg Mehl"]);
  });
  test("Aufzählungszeichen und Leerzeilen", () => {
    assert.deepEqual(splitIngredients("- 2 Eier\r\n\r\n• Butter"), ["2 Eier", "Butter"]);
    assert.deepEqual(splitIngredients(""), []);
    assert.deepEqual(splitIngredients(null), []);
  });
});

describe("foodmatch: parseIngredientsLocal", () => {
  test("Mischtext mit unbekannter Zutat", () => {
    const text = "200 g Rinderhack, 2 Eier und 1 EL Butter\n1/2 Avocado\n1 Dose Zauberstaub";
    const r = parseIngredientsLocal(text, FOODS);
    assert.deepEqual(r.warnings, ['„Zauberstaub" nicht erkannt']);
    assert.deepEqual(r.ingredients.map((i) => [i.name, i.grams, i.foodId, i.source]), [
      ["Rinderhack", 200, "rinderhack", "db"],
      ["Eier", 120, "ei", "db"],
      ["Butter", 14, "butter", "db"],
      ["Avocado", 75, "avocado", "db"],
    ]);
    assert.deepEqual(r.ingredients[0].per100, { kcal: 250, protein: 20, fat: 19, carbs: 0, fiber: 0 });
    assert.equal(r.ingredients[0].note, "");
  });

  test("per100 ist eine Kopie", () => {
    const r = parseIngredientsLocal("100 g Reis", FOODS);
    r.ingredients[0].per100.kcal = 1;
    assert.equal(FOODS.find((f) => f.id === "reis").per100.kcal, 350);
  });

  test("unklare Menge → Warnung, Zutat ausgelassen", () => {
    const r = parseIngredientsLocal("Rinderhack, 100 g Reis", FOODS);
    assert.deepEqual(r.warnings, ['Menge für „Rinderhack" unklar']);
    assert.deepEqual(r.ingredients.map((i) => i.foodId), ["reis"]);
  });

  test("Einheit ohne passende Angabe im Food", () => {
    const r = parseIngredientsLocal("1 EL Rinderhack", FOODS);
    assert.equal(r.ingredients.length, 0);
    assert.deepEqual(r.warnings, ['Menge für „Rinderhack" unklar']);
  });

  test("Dezimalkomma, umgekehrte Reihenfolge, leerer Text", () => {
    const r = parseIngredientsLocal("1,5 l Milch, Reis 80 g, 3 Zehen Knoblauch", FOODS);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.ingredients.map((i) => [i.foodId, i.grams]), [["milch", 1545], ["reis", 80], ["knoblauch", 15]]);
    assert.deepEqual(parseIngredientsLocal("", FOODS), { ingredients: [], warnings: [] });
  });

  test("Eingabe-Foods bleiben unverändert", () => {
    const frozen = deepFreeze(structuredClone(FOODS));
    assert.doesNotThrow(() => parseIngredientsLocal("200 g Rinderhack, 2 Eier", frozen));
  });
});

// --------------------------------------------------------------- targets

describe("targets", () => {
  const base = { sex: "w", age: 30, heightCm: 165, weightKg: 65, activity: "leicht", goal: "halten", style: "ausgewogen", meals: 3, goalWeightKg: null };

  test("STYLES enthält alle fünf Stile", () => {
    assert.deepEqual(Object.keys(STYLES), ["ausgewogen", "low-carb", "keto", "primal", "carnivore"]);
    for (const s of Object.values(STYLES)) {
      assert.ok(s.label && s.hint);
      assert.ok(s.carbsGrams !== undefined || s.carbsPercent !== undefined);
      assert.deepEqual(Object.keys(s.proteinPerKg), ["abnehmen", "halten", "aufbauen"]);
    }
  });

  // BMR = 650 + 1031,25 − 150 − 161 = 1370,25; TDEE = 1370,25 × 1,55 = 2123,89 → 2120 kcal
  // Referenzgewicht = min(65; 25 × 1,65²) = 65
  test("w, 30 J., 165 cm, 65 kg, leicht, halten: ausgewogen", () => {
    const t = calcTargets(base);
    assert.deepEqual(t, {
      bmr: 1370, tdee: 2124, kcal: 2120, protein: 91, fat: 89, carbs: 239,
      perMeal: { kcal: 710, protein: 30, fat: 30, carbs: 80 },
      warnings: [], style: "ausgewogen",
    });
  });

  test("gleiches Profil: low-carb", () => {
    const t = calcTargets({ ...base, style: "low-carb" });
    assert.equal(t.kcal, 2120);
    assert.equal(t.protein, 104); // 1,6 × 65
    assert.equal(t.carbs, 50);
    assert.equal(t.fat, 167); // (2120 − 416 − 200) / 9 = 167,1
    assert.deepEqual(t.perMeal, { kcal: 710, protein: 35, fat: 56, carbs: 17 });
  });

  test("gleiches Profil: keto", () => {
    const t = calcTargets({ ...base, style: "keto" });
    assert.equal(t.protein, 98); // 1,5 × 65 = 97,5
    assert.equal(t.carbs, 30);
    assert.equal(t.fat, 179); // (2120 − 392 − 120) / 9 = 178,7
  });

  test("gleiches Profil: primal", () => {
    const t = calcTargets({ ...base, style: "primal" });
    assert.equal(t.protein, 104);
    assert.equal(t.carbs, 100);
    assert.equal(t.fat, 145); // (2120 − 416 − 400) / 9 = 144,9
  });

  test("gleiches Profil: carnivore", () => {
    const t = calcTargets({ ...base, style: "carnivore" });
    assert.equal(t.protein, 117); // 1,8 × 65
    assert.equal(t.carbs, 10);
    assert.equal(t.fat, 179); // (2120 − 468 − 40) / 9 = 179,1
  });

  // BMR = 900 + 1125 − 200 + 5 = 1830; TDEE = 1830 × 1,7 = 3111; × 0,85 = 2644 → 2640
  // Referenzgewicht = min(90; 25 × 1,8²) = 81 → Eiweiß 1,6 × 81 = 129,6 → 130
  test("m, 40 J., 180 cm, 90 kg, aktiv, abnehmen: Referenzgewicht greift", () => {
    const t = calcTargets({ ...base, sex: "m", age: 40, heightCm: 180, weightKg: 90, activity: "aktiv", goal: "abnehmen" });
    assert.equal(t.bmr, 1830);
    assert.equal(t.tdee, 3111);
    assert.equal(t.kcal, 2640);
    assert.equal(t.protein, 130);
    assert.equal(t.carbs, 297); // 45 % × 2640 / 4
    assert.equal(t.fat, 104); // (2640 − 520 − 1188) / 9 = 103,6
    assert.deepEqual(t.warnings, []);
  });

  test("aufbauen: +10 %", () => {
    // 2123,89 × 1,1 = 2336,3 → 2340; Eiweiß 1,8 × 65 = 117
    const t = calcTargets({ ...base, goal: "aufbauen" });
    assert.equal(t.kcal, 2340);
    assert.equal(t.protein, 117);
  });

  test("alle Aktivitätsstufen", () => {
    const kcal = (activity) => calcTargets({ ...base, activity }).tdee;
    assert.equal(kcal("sitzend"), Math.round(1370.25 * 1.4));
    assert.equal(kcal("leicht"), Math.round(1370.25 * 1.55));
    assert.equal(kcal("aktiv"), Math.round(1370.25 * 1.7));
    assert.equal(kcal("sehr-aktiv"), Math.round(1370.25 * 1.9));
  });

  test("Schutzregel 1: BMI unter 18,5 und abnehmen → wie halten", () => {
    // 50 kg / 1,70² = 17,3. BMR = 500 + 1062,5 − 125 − 161 = 1276,5; TDEE = 1978,6 → 1980
    const t = calcTargets({ ...base, age: 25, heightCm: 170, weightKg: 50, goal: "abnehmen" });
    assert.equal(t.kcal, 1980);
    assert.equal(t.protein, 70); // Eiweiß-Faktor „halten“: 1,4 × 50
    assert.equal(t.warnings.length, 1);
    assert.match(t.warnings[0], /BMI/);
    // Vergleich: mit Ziel halten identisch
    const h = calcTargets({ ...base, age: 25, heightCm: 170, weightKg: 50, goal: "halten" });
    assert.equal(h.kcal, t.kcal);
    assert.equal(h.protein, t.protein);
    assert.deepEqual(h.warnings, []);
  });

  test("Schutzregel 2: unter 18 und abnehmen → Defizit höchstens 10 %", () => {
    // BMR = 700 + 1093,75 − 80 + 5 = 1718,75; TDEE = 2664,06; × 0,9 = 2397,7 → 2400
    const p = { ...base, sex: "m", age: 16, heightCm: 175, weightKg: 70, goal: "abnehmen" };
    const t = calcTargets(p);
    assert.equal(t.kcal, 2400);
    assert.equal(t.warnings.length, 1);
    assert.match(t.warnings[0], /18/);
    // Ab 18 volles Defizit: BMR 1708,75, TDEE 2648,6 × 0,85 = 2251,3 → 2250
    const adult = calcTargets({ ...p, age: 18 });
    assert.equal(adult.kcal, 2250);
    assert.deepEqual(adult.warnings, []);
  });

  test("Schutzregel 3: kcal nie unter BMR", () => {
    // Mit den Vertragsfaktoren (PAL ≥ 1,4, Defizit ≤ 15 %) ist TDEE × Faktor immer ≥ 1,19 × BMR;
    // die Regel greift also nicht. Geprüft wird die Invariante über viele Profile.
    for (const sex of ["w", "m"]) {
      for (const activity of ["sitzend", "leicht", "aktiv", "sehr-aktiv"]) {
        for (const goal of ["abnehmen", "halten", "aufbauen"]) {
          for (const [age, heightCm, weightKg] of [[16, 150, 45], [30, 165, 65], [70, 160, 65], [45, 190, 120]]) {
            const t = calcTargets({ ...base, sex, activity, goal, age, heightCm, weightKg });
            assert.ok(t.kcal >= t.bmr, `${sex} ${activity} ${goal} ${age}`);
          }
        }
      }
    }
  });

  test("Mindestfett: Kohlenhydrate werden zuerst gekürzt", () => {
    // w, 70 J., 160 cm, 65 kg, sitzend, abnehmen. BMR = 650 + 1000 − 350 − 161 = 1139;
    // TDEE = 1594,6; × 0,85 = 1355,4 → 1360. Referenzgewicht = min(65; 64) = 64 → Mindestfett 38,4 → 39 g
    // Eiweiß 1,6 × 64 = 102,4 → 102. Ohne Regel: KH 153, Fett (1360 − 408 − 612)/9 = 37,8 < 38,4
    const t = calcTargets({ ...base, age: 70, heightCm: 160, weightKg: 65, activity: "sitzend", goal: "abnehmen" });
    assert.equal(t.kcal, 1360);
    assert.equal(t.protein, 102);
    assert.equal(t.fat, 39);
    assert.ok(t.fat >= 0.6 * 64);
    assert.equal(t.carbs, 150); // (1360 − 408 − 351) / 4 = 150,25
    assert.equal(t.warnings.length, 1);
    assert.match(t.warnings[0], /Kohlenhydrate/);
  });

  test("Mindestfett: reicht die Energie nicht, bleiben 0 g Kohlenhydrate und eine Warnung", () => {
    // Erfundene, extreme Tabelle: Eiweiß so hoch, dass selbst ohne Kohlenhydrate kein Mindestfett übrig bleibt
    const saved = STYLES.carnivore.proteinPerKg.halten;
    STYLES.carnivore.proteinPerKg.halten = 10;
    try {
      const t = calcTargets({ ...base, style: "carnivore" });
      assert.equal(t.carbs, 0);
      assert.equal(t.fat, 39);
      assert.equal(t.warnings.length, 1);
      assert.match(t.warnings[0], /Mindestfett/);
    } finally {
      STYLES.carnivore.proteinPerKg.halten = saved;
    }
  });

  test("kcal ≈ 4·Eiweiß + 4·KH + 9·Fett für alle Stile und Ziele", () => {
    for (const style of Object.keys(STYLES)) {
      for (const goal of ["abnehmen", "halten", "aufbauen"]) {
        const t = calcTargets({ ...base, style, goal });
        const sum = 4 * t.protein + 4 * t.carbs + 9 * t.fat;
        assert.ok(Math.abs(sum - t.kcal) <= 15, `${style}/${goal}: ${sum} vs ${t.kcal}`);
        assert.ok(t.fat >= 0.6 * 65);
        assert.equal(t.style, style);
      }
    }
  });

  test("perMeal = Tageswerte / Mahlzeiten", () => {
    const t2 = calcTargets({ ...base, meals: 2 });
    assert.deepEqual(t2.perMeal, { kcal: 1060, protein: 46, fat: 45, carbs: 120 });
    const t4 = calcTargets({ ...base, meals: 4 });
    assert.deepEqual(t4.perMeal, { kcal: 530, protein: 23, fat: 22, carbs: 60 });
  });

  test("Zahlen sind ganz, kcal auf 10 gerundet, nie NaN", () => {
    const t = calcTargets(base);
    for (const k of ["bmr", "tdee", "kcal", "protein", "fat", "carbs"]) assert.ok(Number.isInteger(t[k]), k);
    assert.equal(t.kcal % 10, 0);
    assert.equal(t.perMeal.kcal % 10, 0);
  });

  test("unvollständiges oder ungültiges Profil → null", () => {
    assert.equal(calcTargets(null), null);
    assert.equal(calcTargets(undefined), null);
    assert.equal(calcTargets({}), null);
    for (const key of ["sex", "age", "heightCm", "weightKg", "activity", "goal", "style", "meals"]) {
      const p = { ...base };
      delete p[key];
      assert.equal(calcTargets(p), null, `ohne ${key}`);
    }
    assert.equal(calcTargets({ ...base, age: NaN }), null);
    assert.equal(calcTargets({ ...base, weightKg: 0 }), null);
    assert.equal(calcTargets({ ...base, style: "vegan" }), null);
    assert.equal(calcTargets({ ...base, sex: "x" }), null);
  });

  test("Profil wird nicht verändert", () => {
    assert.doesNotThrow(() => calcTargets(deepFreeze({ ...base })));
  });

  test("styleFit", () => {
    const t = calcTargets({ ...base, style: "keto" }); // perMeal.carbs = 10
    assert.equal(t.perMeal.carbs, 10);
    assert.deepEqual(styleFit({ carbs: 11 }, t), { fits: true, label: "passt zu Keto" });
    assert.deepEqual(styleFit({ carbs: 11.1 }, t), { fits: false, label: "zu viele Kohlenhydrate für Keto" });
    assert.equal(styleFit({ carbs: 0 }, t).fits, true);
    assert.equal(styleFit({}, t).fits, true);
    const lc = calcTargets({ ...base, style: "low-carb" });
    assert.equal(styleFit({ carbs: 40 }, lc).label, "zu viele Kohlenhydrate für Low Carb");
    assert.deepEqual(styleFit({ carbs: 40 }, null), { fits: true, label: "" });
  });
});

// -------------------------------------------------------------- shopping

describe("shopping", () => {
  const per = { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 };
  const recipes = [
    { id: "r1", name: "Bolognese", portions: 2, createdAt: "x", ingredients: [
      { name: "Rinderhack", grams: 400, foodId: "rinderhack", per100: per, source: "db" },
      { name: "Zwiebel", grams: 100, foodId: "zwiebel", per100: per, source: "db" },
      { name: "Salz", grams: 5, foodId: null, per100: per, source: "manual" },
      { name: "Zauberpulver", grams: 3, foodId: "gibt-es-nicht", per100: per, source: "ai" },
    ] },
    { id: "r2", name: "Omelett", portions: 1, createdAt: "x", ingredients: [
      { name: "Eier", grams: 180, foodId: "ei", per100: per, source: "db" },
      { name: "Butter", grams: 10, foodId: "butter", per100: per, source: "db" },
      { name: "salz", grams: 2, foodId: null, per100: per, source: "manual" },
      { name: "Zwiebel", grams: 50, foodId: "zwiebel", per100: per, source: "db" },
    ] },
  ];

  test("Kategorien", () => {
    assert.equal(CATEGORIES.length, 11);
    assert.equal(CATEGORIES[0], "fleisch");
    assert.equal(CATEGORIES.at(-1), "getraenke");
    for (const c of CATEGORIES) assert.ok(CATEGORY_LABELS[c], c);
  });

  test("Skalierung, Zusammenfassen über foodId und Namen, Sortierung", () => {
    const list = buildShoppingList(recipes, [{ recipeId: "r1", portions: 4 }, { recipeId: "r2", portions: 1 }], FOODS);
    assert.deepEqual(list, [
      { key: "rinderhack", name: "Rinderhack", grams: 800, category: "fleisch", fromRecipes: ["Bolognese"] },
      { key: "ei", name: "Eier", grams: 180, category: "eier-milch", fromRecipes: ["Omelett"] },
      { key: "zwiebel", name: "Zwiebel", grams: 250, category: "gemuese", fromRecipes: ["Bolognese", "Omelett"] },
      { key: "butter", name: "Butter", grams: 10, category: "fette-oele", fromRecipes: ["Omelett"] },
      { key: "x:salz", name: "Salz", grams: 12, category: "gewuerze-sonstiges", fromRecipes: ["Bolognese", "Omelett"] },
      { key: "gibt-es-nicht", name: "Zauberpulver", grams: 6, category: "gewuerze-sonstiges", fromRecipes: ["Bolognese"] },
    ]);
  });

  test("halbe Portionen und nicht ganzzahlige Skalierung", () => {
    const list = buildShoppingList(recipes, [{ recipeId: "r1", portions: 1 }], FOODS);
    assert.equal(list.find((i) => i.key === "rinderhack").grams, 200);
    assert.equal(list.find((i) => i.key === "x:salz").grams, 2.5);
    const third = buildShoppingList(recipes, [{ recipeId: "r1", portions: 3 }], FOODS);
    assert.equal(third.find((i) => i.key === "rinderhack").grams, 600);
  });

  test("dasselbe Rezept zweimal gewählt wird zusammengefasst", () => {
    const list = buildShoppingList(recipes, [{ recipeId: "r2", portions: 1 }, { recipeId: "r2", portions: 2 }], FOODS);
    const egg = list.find((i) => i.key === "ei");
    assert.equal(egg.grams, 540);
    assert.deepEqual(egg.fromRecipes, ["Omelett"]);
  });

  test("unbekanntes Rezept, Portionen 0, leere Eingaben", () => {
    assert.deepEqual(buildShoppingList(recipes, [{ recipeId: "nope", portions: 2 }], FOODS), []);
    assert.deepEqual(buildShoppingList(recipes, [{ recipeId: "r1", portions: 0 }], FOODS), []);
    assert.deepEqual(buildShoppingList(recipes, [{ recipeId: "r1", portions: NaN }], FOODS), []);
    assert.deepEqual(buildShoppingList([], [], []), []);
    assert.deepEqual(buildShoppingList(undefined, undefined, undefined), []);
  });

  test("Sortierung nach Name innerhalb der Kategorie, Umlaute deutsch", () => {
    const rs = [{ id: "a", name: "A", portions: 1, ingredients: [
      { name: "Zucchini", grams: 100, foodId: null, per100: per, source: "manual" },
      { name: "Äpfel", grams: 100, foodId: null, per100: per, source: "manual" },
      { name: "Basilikum", grams: 100, foodId: null, per100: per, source: "manual" },
    ] }];
    const list = buildShoppingList(rs, [{ recipeId: "a", portions: 1 }], []);
    assert.deepEqual(list.map((i) => i.name), ["Äpfel", "Basilikum", "Zucchini"]);
  });

  test("Eingaben werden nicht verändert", () => {
    const r = deepFreeze(structuredClone(recipes));
    const s = deepFreeze([{ recipeId: "r1", portions: 4 }]);
    const f = deepFreeze(structuredClone(FOODS));
    assert.doesNotThrow(() => buildShoppingList(r, s, f));
  });

  test("formatAmount", () => {
    assert.equal(formatAmount(250), "250 g");
    assert.equal(formatAmount(250.4), "250 g");
    assert.equal(formatAmount(4.5), "4,5 g");
    assert.equal(formatAmount(999), "999 g");
    assert.equal(formatAmount(1000), "1 kg");
    assert.equal(formatAmount(1200), "1,2 kg");
    assert.equal(formatAmount(2500), "2,5 kg");
    assert.equal(formatAmount(999.6), "1 kg");
    assert.equal(formatAmount(NaN), "0 g");
    assert.equal(formatAmount(undefined), "0 g");
    const ei = FOODS.find((f) => f.id === "ei");
    assert.equal(formatAmount(180, ei), "180 g (≈ 3 Stück)");
    assert.equal(formatAmount(50, ei), "50 g (≈ 1 Stück)");
    assert.equal(formatAmount(30, ei), "30 g");
    assert.equal(formatAmount(180, FOODS.find((f) => f.id === "butter")), "180 g");
    assert.equal(formatAmount(1200, ei), "1,2 kg (≈ 20 Stück)");
  });
});

// ---------------------------------------------------------------- weight

describe("weight", () => {
  const entries = [
    { date: "2026-03-03", kg: 79 },
    { date: "2026-03-01", kg: 80 },
    { date: "2026-03-10", kg: 78 },
    { date: "2026-03-02", kg: 79.5 },
  ];

  test("sortEntries: aufsteigend, neue Liste, Original unverändert", () => {
    const input = deepFreeze(structuredClone(entries));
    const sorted = sortEntries(input);
    assert.deepEqual(sorted.map((e) => e.date), ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-10"]);
    assert.notEqual(sorted, input);
    assert.deepEqual(input.map((e) => e.date), ["2026-03-03", "2026-03-01", "2026-03-10", "2026-03-02"]);
    assert.deepEqual(sortEntries([]), []);
    assert.deepEqual(sortEntries(undefined), []);
  });

  test("movingAverage 7 Tage", () => {
    assert.deepEqual(movingAverage(entries), [
      { date: "2026-03-01", kg: 80 },
      { date: "2026-03-02", kg: 79.75 },
      { date: "2026-03-03", kg: 79.5 },
      { date: "2026-03-10", kg: 78 }, // 03-03 liegt 7 Tage zurück und damit außerhalb von [03-04, 03-10]
    ]);
  });

  test("movingAverage: Fenstergrenzen", () => {
    const e = [{ date: "2026-03-01", kg: 80 }, { date: "2026-03-07", kg: 70 }, { date: "2026-03-08", kg: 60 }];
    const r = movingAverage(e, 7);
    assert.equal(r[1].kg, 75); // 03-01 liegt genau 6 Tage zurück → im Fenster
    assert.equal(r[2].kg, 65); // 03-01 liegt 7 Tage zurück → draußen; (70 + 60) / 2
    assert.equal(movingAverage(e, 1)[1].kg, 70);
    assert.equal(movingAverage(e, 30)[2].kg, 70);
  });

  test("movingAverage: Monatswechsel und Zeitumstellung", () => {
    const feb = [{ date: "2026-02-28", kg: 70 }, { date: "2026-03-01", kg: 72 }];
    assert.equal(movingAverage(feb, 2)[1].kg, 71);
    const dst = [{ date: "2026-03-28", kg: 70 }, { date: "2026-03-29", kg: 72 }, { date: "2026-03-30", kg: 74 }];
    assert.equal(movingAverage(dst, 2)[1].kg, 71);
    assert.equal(movingAverage(dst, 2)[2].kg, 73);
    const leap = [{ date: "2028-02-28", kg: 70 }, { date: "2028-02-29", kg: 72 }, { date: "2028-03-01", kg: 74 }];
    assert.equal(movingAverage(leap, 2)[2].kg, 73);
    assert.equal(movingAverage(leap, 3)[2].kg, 72);
  });

  test("movingAverage: leer", () => {
    assert.deepEqual(movingAverage([]), []);
  });

  const profile = { heightCm: 165, goalWeightKg: 70 };

  test("weightStats: Start, aktuell, Änderung, BMI, Rate, Ziel", () => {
    const s = weightStats(entries, profile);
    assert.equal(s.start, 80);
    assert.equal(s.current, 78);
    assert.equal(s.change, -2);
    assert.equal(s.bmi, 28.7); // 78 / 1,65²
    assert.equal(s.toGoal, -8);
    // Regression über x = −9, −8, −7, 0 und y = 80; 79,5; 79; 78 → −0,2 kg/Tag = −1,4 kg/Woche
    assert.equal(s.weeklyRate, -1.4);
  });

  test("weightStats: nur die letzten 28 Tage zählen für weeklyRate", () => {
    const e = [
      { date: "2026-01-01", kg: 90 },
      { date: "2026-03-01", kg: 80 },
      { date: "2026-03-08", kg: 79 },
    ];
    const s = weightStats(e, null);
    assert.equal(s.weeklyRate, -1);
    assert.equal(s.start, 90);
    assert.equal(s.change, -11);
    // Eintrag genau 28 Tage vor dem letzten liegt schon draußen (Rate nur aus den zwei späteren: −1 kg in 1 Tag)
    const edge = [{ date: "2026-03-01", kg: 80 }, { date: "2026-03-28", kg: 79 }, { date: "2026-03-29", kg: 78 }];
    assert.equal(weightStats(edge, null).weeklyRate, -7);
    // 27 Tage davor zählt noch: Punkte (−27; 80), (−1; 79), (0; 78)
    const inside = [{ date: "2026-03-02", kg: 80 }, { date: "2026-03-28", kg: 79 }, { date: "2026-03-29", kg: 78 }];
    assert.equal(weightStats(inside, null).weeklyRate, -0.4); // −27 / 468,67 × 7
  });

  test("weightStats: ohne Profil bzw. Zielgewicht", () => {
    const a = weightStats(entries, null);
    assert.equal(a.bmi, null);
    assert.equal(a.toGoal, null);
    const b = weightStats(entries, { heightCm: 165, goalWeightKg: null });
    assert.equal(b.bmi, 28.7);
    assert.equal(b.toGoal, null);
    const c = weightStats(entries, { goalWeightKg: 70 });
    assert.equal(c.bmi, null);
    assert.equal(c.toGoal, -8);
  });

  test("weightStats: unter 2 Einträgen", () => {
    assert.equal(weightStats([], profile), null);
    assert.equal(weightStats(undefined, profile), null);
    const one = weightStats([{ date: "2026-03-01", kg: 80 }], profile);
    assert.equal(one.weeklyRate, null);
    assert.equal(one.start, 80);
    assert.equal(one.current, 80);
    assert.equal(one.change, 0);
    assert.equal(one.toGoal, -10);
  });

  test("weightStats: Eingabe bleibt unverändert", () => {
    assert.doesNotThrow(() => weightStats(deepFreeze(structuredClone(entries)), deepFreeze({ ...profile })));
  });
});
