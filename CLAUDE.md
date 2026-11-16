# Makroküche

Persönliche Ernährungs-App für eine Nutzerin (kein Login). Funktionen: Makro-Ziele aus einem
Fragebogen, Makro-Rechner für Zutaten mit KI-Unterstützung, gespeicherte Rezepte, Einkaufsliste,
Gewichts-Tracker. Ernährungsstile: Ausgewogen, Low Carb, Keto, Primal, Carnivore.

Funktional an Foodpunk angelehnt (Fragebogen → persönliche Makros, Kohlenhydrat-Stufen, Rezepte grammgenau,
Einkaufsliste). Design, Texte, Name und Rezepte sind eigenständig. Nichts von Foodpunk kopieren.

## Umbau 11/2026: reine Browser-App für GitHub Pages (hat Vorrang vor älteren Abschnitten)

Die App läuft ohne eigenen Server als statische Seite (GitHub Pages, Unterpfad `/<repo>/`).

- **Kein Server-API mehr.** `public/js/api.js` behält exakt dieselben Methoden wie im Frontend-Vertrag,
  arbeitet aber lokal: Daten über `public/js/store.js` in `localStorage`, KI über `public/js/ai.js`
  direkt aus dem Browser. Die Ansichten bleiben dadurch unverändert.
- **Alle Pfade relativ** (`css/app.css`, `js/app.js`, `data/foods.json`, `css/views/x.css`, `sw.js`,
  `manifest.webmanifest`, `icon.svg`). Kein führender Schrägstrich, sonst bricht der Unterpfad.
- **Speicher-Schlüssel:** `makrokueche.state.v1` (State), `makrokueche.settings.v1` (Einstellungen),
  `makrokueche.draft` (sessionStorage, Rechner-Entwurf).
- **Einstellungen:** `Settings = { geminiKey, openrouterKey, geminiModel, openrouterModel }`.
  Die Keys gibt die Nutzerin in der Profil-Ansicht ein. Sie liegen nur im `localStorage` dieses Browsers,
  stehen nie im Repo, nie im Export und gehen nur an Google bzw. OpenRouter.
- **Neue api-Methoden:** `api.getSettings()`, `api.saveSettings(s)`, `api.exportData()`, `api.importData(obj)`.
  - Export: `{ app: "makrokueche", version: 1, exportedAt: ISO, state: State }` (ohne Einstellungen/Keys).
  - Import: prüft `app`/`version` und jeden Teil mit denselben Regeln wie beim Speichern, ersetzt dann den State.
- **store.js:** `createStore(storage = globalThis.localStorage)` mit `getState, saveProfile, setWeight,
  deleteWeight, createRecipe, updateRecipe, deleteRecipe, saveShopping, getSettings, saveSettings,
  exportData, importData`. Synchron, wirft `Error` mit deutschem Text bei ungültigen Eingaben
  (dieselben Grenzen wie bisher im Server). Kaputtes JSON im Speicher: Rohtext unter
  `makrokueche.state.kaputt` sichern, mit leerem State weitermachen.
- **ai.js (Browser):** dieselbe Kette Gemini → OpenRouter → lokaler Parser, dieselbe Nachprüfung.
  Gemini im Browser **ohne** den Header `Api-Revision` (CORS erlaubt nur `x-goog-api-key` und
  `content-type`, per Preflight geprüft). Antwort tolerant lesen: letzter `steps[]`-Eintrag vom Typ
  `model_output`, sonst `outputs[]`/`output_text`. OpenRouter erlaubt Browser-Anfragen (CORS `*`).
- **CSP** als Meta-Tag in `index.html`: `default-src 'self'; connect-src 'self'
  https://generativelanguage.googleapis.com https://openrouter.ai; img-src 'self' data:;
  style-src 'self' 'unsafe-inline'; base-uri 'self'`.
- **Lokale Vorschau:** `server.js` ist nur noch ein kleiner statischer Dateiserver für `public/`.
- **Veröffentlichung:** `.github/workflows/pages.yml` lädt `public/` zu GitHub Pages hoch.

## Regeln

- Keine npm-Abhängigkeiten. Nur Node 24 Bordmittel (`node:http`, `node:fs`, `node:test`, globales `fetch`).
- Sprache der Oberfläche: Deutsch, echte Umlaute. Zahlen im Format `de-DE`.
- `.env` niemals lesen, ausgeben, loggen oder committen. Keys erscheinen in keiner Antwort und keinem Log.
- An die KI geht nur der Zutatentext. Keine Profil-, Gewichts- oder sonstigen persönlichen Daten.
- Nur kostenlose KI-Modelle. Modellnamen kommen aus `.env`, Standardwerte siehe unten.
- Nährwerte kommen aus `public/data/foods.json`. KI-Schätzungen nur für unbekannte Zutaten, immer als
  Schätzung markiert (`source: "ai"`).
- Kein `innerHTML` mit Nutzerdaten. DOM über `h()` aus `public/js/ui.js` oder `textContent` bauen.
- Inhalte nie mit dem nativen `el.replaceChildren(a, b)` setzen, sondern mit `fill(el, a, b)` aus `ui.js`:
  das native überspringt `null` nicht, sondern schreibt den Text "null" in die Seite.
- Server-Pfade immer relativ zu `import.meta.dirname`, nie relativ zum Arbeitsverzeichnis.
- Keine Commits oder Pushes ohne Auftrag.

## Start und Test

- Start: `node --env-file-if-exists=.env server.js` (oder `npm start`), dann http://127.0.0.1:5175
- Tests: `node --test` (oder `npm test`)

## Dateien

```
server.js                  HTTP-Server: statische Dateien aus public/, JSON-API unter /api
server/store.js            Persistenz in data/db.json (atomar schreiben)
server/ai.js               KI-Kette: Gemini → OpenRouter → lokaler Parser
data/db.json               Nutzerdaten (wird zur Laufzeit angelegt, nicht im Repo)
public/index.html          App-Hülle
public/css/app.css         Design-System
public/js/app.js           Router, Navigation, ctx
public/js/ui.js            h(), Formatierer, Toast
public/js/api.js           fetch-Wrapper für /api
public/js/core/*.js        reine Logik ohne DOM (läuft in Browser und Node)
public/js/views/*.js       je Ansicht eine Datei
public/data/foods.json     Lebensmitteltabelle
public/manifest.webmanifest, public/sw.js, public/icon.svg   PWA
test/*.test.js             node:test
```

## Datenformen

```js
// Nährwerte je 100 g. carbs = verwertbare Kohlenhydrate OHNE Ballaststoffe (EU-Konvention).
Per100 = { kcal, protein, fat, carbs, fiber }            // Zahlen, g bzw. kcal

Food = {
  id: "rinderhack",                 // kleinbuchstaben, a-z 0-9 und "-", eindeutig
  name: "Rinderhackfleisch",
  aliases: ["Rinderhack", "Hackfleisch vom Rind"],
  category: "fleisch",              // siehe CATEGORIES
  per100: Per100,
  units: { stueck: 60, el: 14 }     // optional: Einheit → Gramm. Schlüssel: stueck, el, tl, scheibe,
}                                   // becher, tasse, handvoll, zehe, dose, bund, prise, ml (g je ml)

CATEGORIES = ["fleisch","fisch","eier-milch","gemuese","obst","nuesse-samen","fette-oele",
              "getreide-beilagen","huelsenfruechte","gewuerze-sonstiges","getraenke"]

Ingredient = {
  name: "Rinderhack",               // Anzeigename
  grams: 200,
  foodId: "rinderhack" | null,
  per100: Per100,                   // immer gefüllt (aus DB kopiert, von KI geschätzt oder manuell)
  source: "db" | "ai" | "manual",
  note: ""                          // optional, z. B. "KI-Schätzung, kcal korrigiert"
}

Recipe  = { id, name, portions, ingredients: Ingredient[], createdAt }   // id: crypto.randomUUID()
Profile = { sex: "w"|"m", age, heightCm, weightKg,
            activity: "sitzend"|"leicht"|"aktiv"|"sehr-aktiv",
            goal: "abnehmen"|"halten"|"aufbauen",
            style: "ausgewogen"|"low-carb"|"keto"|"primal"|"carnivore",
            meals: 2|3|4, goalWeightKg: number|null }
WeightEntry = { date: "YYYY-MM-DD", kg }                  // ein Eintrag je Datum
Shopping = { selections: [{ recipeId, portions }],        // welche Rezepte, wie viele Portionen
             manual: [{ id, text, checked }],             // freie Einträge
             checked: { [key]: true } }                   // abgehakte berechnete Einträge
State = { profile: Profile|null, weights: WeightEntry[], recipes: Recipe[], shopping: Shopping }
```

## API (alles JSON)

| Methode | Pfad | Body | Antwort |
|---|---|---|---|
| GET | /api/health | | `{ ok: true, ai: { gemini: bool, openrouter: bool } }` (nur ob Key gesetzt ist) |
| GET | /api/state | | `State` |
| PUT | /api/profile | `Profile` | `Profile` |
| PUT | /api/weights/:date | `{ kg }` | `WeightEntry[]` (sortiert nach Datum) |
| DELETE | /api/weights/:date | | `WeightEntry[]` |
| POST | /api/recipes | `{ name, portions, ingredients }` | `Recipe` |
| PUT | /api/recipes/:id | `{ name, portions, ingredients }` | `Recipe` |
| DELETE | /api/recipes/:id | | `{ ok: true }` |
| PUT | /api/shopping | `Shopping` | `Shopping` |
| POST | /api/ai/parse | `{ text }` | `{ ingredients: Ingredient[], provider: "gemini"|"openrouter"|"lokal", warnings: string[] }` |

Fehler: `{ error: "deutscher Klartext" }` mit passendem Status (400 ungültige Eingabe, 404, 413 Body
über 100 kB, 429 zu viele KI-Anfragen, 500).

## Kernmodule (`public/js/core/`, reine ES-Module, keine DOM- oder Node-APIs)

```js
// macros.js
round1(n)                              // auf 1 Nachkommastelle
atwaterKcal(per100)                    // 4*protein + 4*carbs + 9*fat + 2*fiber
checkPer100(per100)                    // → { ok, problems: string[], fixed: Per100 }
                                       //   Regeln: alle Werte ≥ 0, Makros ≤ 100, kcal ≤ 900,
                                       //   protein+fat+carbs+fiber ≤ 102,
                                       //   |kcal − atwater| ≤ max(25, 20 % von atwater), sonst
                                       //   fixed.kcal = gerundeter Atwater-Wert
ingredientMacros(ing)                  // → { kcal, protein, fat, carbs, fiber } für ing.grams
sumMacros(ingredients)                 // → Summe
perPortion(total, portions)            // → geteilt, portions < 1 wird wie 1 behandelt
macroPercents(m)                       // → { protein, fat, carbs } Energie-% (Summe ≈ 100, bei 0 kcal alles 0)

// foodmatch.js
normalize(str)                         // klein, ä→ae ö→oe ü→ue ß→ss, Satzzeichen weg, Mehrfach-Leerzeichen weg
findFood(query, foods)                 // → Food|null, bester Treffer über name + aliases (exakt > Wortanfang
                                       //   > enthält > einfache Plural-/Wortüberschneidung), null wenn unsicher
searchFoods(query, foods, limit = 8)   // → Food[] für Autovervollständigung
parseLine(text)                        // "200 g Rinderhack" | "2 Eier" | "1 EL Butter" | "1/2 Avocado" |
                                       // "1,5 l Milch" | "eine Prise Salz" → { amount, unit, name }
                                       // unit ∈ "g","kg","ml","l","stueck","el","tl","scheibe","becher",
                                       // "tasse","handvoll","zehe","dose","bund","prise" oder null
toGrams(parsed, food)                  // → Gramm|null (g/kg direkt, ml/l über food.units.ml oder 1 g/ml,
                                       //   sonst food.units[unit], ohne Einheit food.units.stueck)
splitIngredients(text)                 // Freitext an Zeilenumbruch, Komma, Semikolon, " und " trennen
parseIngredientsLocal(text, foods)     // → { ingredients: Ingredient[], warnings: string[] }
                                       //   unbekannte Zutat oder unbekannte Menge → Warnung, Zutat auslassen

// targets.js
STYLES                                 // Tabelle der Stile, siehe unten
calcTargets(profile)                   // → { bmr, tdee, kcal, protein, fat, carbs,
                                       //     perMeal: { kcal, protein, fat, carbs }, warnings: string[] }
styleFit(perPortionMacros, targets)    // → { fits: bool, label: string } Kohlenhydrate je Portion gegen perMeal.carbs

// shopping.js
buildShoppingList(recipes, selections, foods)
                                       // → [{ key, name, grams, category, fromRecipes: string[] }]
                                       //   Zutaten skaliert mit selection.portions / recipe.portions,
                                       //   zusammengefasst über foodId (sonst normalize(name)),
                                       //   key = foodId oder "x:" + normalize(name),
                                       //   category aus Food, sonst "gewuerze-sonstiges",
                                       //   sortiert nach CATEGORIES-Reihenfolge, dann Name
formatAmount(grams, food)              // → "250 g", "1,2 kg", bei food.units.stueck zusätzlich "≈ 3 Stück"
CATEGORY_LABELS                        // { fleisch: "Fleisch", ... } deutsche Überschriften
CATEGORIES                             // Reihenfolge wie oben

// weight.js
sortEntries(entries)                   // → nach Datum aufsteigend, neue Liste
movingAverage(entries, days = 7)       // → [{ date, kg }] Mittel der Einträge der letzten `days` Kalendertage
weightStats(entries, profile)          // → { start, current, change, bmi, weeklyRate, toGoal } oder null
                                       //   weeklyRate: kg je Woche aus den letzten 28 Tagen (lineare Regression),
                                       //   null bei unter 2 Einträgen; bmi/toGoal null ohne Profil bzw. Zielgewicht
```

### Zielberechnung (`calcTargets`)

- BMR nach Mifflin-St Jeor: `10*kg + 6.25*cm − 5*alter + (m ? 5 : −161)`.
- TDEE = BMR × PAL: sitzend 1.4, leicht 1.55, aktiv 1.7, sehr-aktiv 1.9.
- Ziel: abnehmen −15 %, halten 0, aufbauen +10 %.
- Schutzregeln (jede löst einen Eintrag in `warnings` aus):
  - BMI unter 18.5 und Ziel abnehmen → wird wie halten gerechnet.
  - Alter unter 18 und Ziel abnehmen → Defizit höchstens 10 %.
  - kcal nie unter BMR.
- Referenzgewicht für Eiweiß: `min(weightKg, 25 * (heightCm/100)^2)`.
- `STYLES[style] = { label, carbsGrams | carbsPercent, proteinPerKg: { abnehmen, halten, aufbauen }, hint }`
  - ausgewogen: carbsPercent 45, Eiweiß 1.6 / 1.4 / 1.8
  - low-carb: 50 g, Eiweiß 1.8 / 1.6 / 2.0
  - keto: 30 g, Eiweiß 1.7 / 1.5 / 1.8
  - primal: 100 g, Eiweiß 1.8 / 1.6 / 2.0
  - carnivore: 10 g, Eiweiß 2.0 / 1.8 / 2.2
- Fett = `(kcal − 4*protein − 4*carbs) / 9`, mindestens `0.6 g × Referenzgewicht`. Reicht die Energie nicht,
  werden zuerst die Kohlenhydrate gekürzt (nicht unter 0), dann Warnung.
- Alle Gramm auf ganze Zahlen, kcal auf 10 runden. `perMeal` = Tageswerte / `profile.meals`.

## KI-Kette (`server/ai.js`)

Reihenfolge: Gemini → OpenRouter → lokaler Parser (`parseIngredientsLocal`). Jeder Anbieter mit 20 s Timeout.
Fehlt ein Key, wird der Anbieter übersprungen. Scheitern beide, antwortet der lokale Parser mit
`provider: "lokal"` und einer Warnung.

Die KI bekommt: Anweisung, die Liste `id|name` aller Foods, den Zutatentext. Sie liefert JSON nach Schema:

```json
{ "items": [ { "name": "", "grams": 0, "foodId": "", "kcal": 0, "protein": 0, "fat": 0, "carbs": 0, "fiber": 0 } ] }
```

`foodId` ist eine id aus der Liste oder `""`. Die Nährwerte sind ihre Schätzung je 100 g.
Der Server vertraut der KI nur bei Name, Gramm und Zuordnung:

- gültige `foodId` → `per100` aus foods.json, `source: "db"`.
- sonst zuerst `findFood(name)` versuchen, erst dann KI-Schätzung durch `checkPer100`, `source: "ai"`,
  bei Korrektur Hinweis in `note` und in `warnings`.
- `grams` muss > 0 und ≤ 5000 sein, sonst Zutat verwerfen und warnen.

Gemini (Stand 11/2026, Interactions API):

```
POST https://generativelanguage.googleapis.com/v1beta/interactions
Header: x-goog-api-key: <key>, Content-Type: application/json, Api-Revision: 2026-05-20
Body:   { "model": GEMINI_MODEL, "input": "<Anweisung + Liste + Text>",
          "response_format": { "type": "text", "mime_type": "application/json", "schema": <JSON-Schema> } }
Antwort: { "steps": [ ..., { "type": "model_output", "content": [ { "type": "text", "text": "<JSON>" } ] } ] }
```

OpenRouter:

```
POST https://openrouter.ai/api/v1/chat/completions
Header: Authorization: Bearer <key>, Content-Type: application/json
Body:   { "model": OPENROUTER_MODEL, "messages": [ { "role": "user", "content": "..." } ],
          "response_format": { "type": "json_schema",
                               "json_schema": { "name": "zutaten", "strict": true, "schema": <JSON-Schema> } } }
Antwort: choices[0].message.content (JSON, eventuell in ```-Zaun oder mit Vortext: erstes {...} herausziehen)
```

Umgebungsvariablen: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_MODEL` (Standard `gemini-3.8-flash`),
`OPENROUTER_MODEL` (Standard `openrouter/free`), `PORT` (5175), `HOST` (127.0.0.1).

## Frontend-Vertrag

- Hash-Routen: `#/rechner` (Start), `#/rezepte`, `#/einkauf`, `#/gewicht`, `#/profil`.
- Jede Ansicht: `export async function render(root, ctx)`. `root` ist leer und gehört der Ansicht.
- `ctx = { state, foods, targets, api, navigate(hash), refresh(), toast(text, kind) }`
  - `state`: letzter Stand von `/api/state`, `foods`: Food[], `targets`: `calcTargets(profile)` oder null.
  - `refresh()`: lädt State neu und rendert die aktuelle Ansicht neu.
  - `kind`: "ok" | "warn" | "error".
- `ui.js`: `h(tag, attrs, ...children)`, `fmt(n, digits = 0)`, `fmtKg(n)`, `todayISO()`, `formatDate(iso)`.
- `api.js`: `api.health()`, `api.getState()`, `api.saveProfile(p)`, `api.setWeight(date, kg)`,
  `api.deleteWeight(date)`, `api.createRecipe(r)`, `api.updateRecipe(id, r)`, `api.deleteRecipe(id)`,
  `api.saveShopping(s)`, `api.parseIngredients(text)`. Fehler werfen `Error` mit dem deutschen Text aus `error`.
- CSS-Klassen stehen in `public/css/app.css` (Kommentarblock am Dateianfang listet alle Bausteine).
