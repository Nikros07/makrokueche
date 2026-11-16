// Zielberechnung. Die Tabelle STYLES kann direkt angepasst werden.
//   carbsGrams    feste Kohlenhydrate in g pro Tag, ODER
//   carbsPercent  Anteil der Tageskalorien in %
//   proteinPerKg  g Eiweiß je kg Referenzgewicht, je nach Ziel

export const STYLES = {
  ausgewogen: {
    label: "Ausgewogen",
    carbsPercent: 45,
    proteinPerKg: { abnehmen: 1.6, halten: 1.4, aufbauen: 1.8 },
    hint: "Ausgewogene Mischkost mit etwa 45 % der Energie aus Kohlenhydraten.",
  },
  "low-carb": {
    label: "Low Carb",
    carbsGrams: 50,
    proteinPerKg: { abnehmen: 1.8, halten: 1.6, aufbauen: 2.0 },
    hint: "Etwa 50 g Kohlenhydrate am Tag, dafür mehr Eiweiß und Fett.",
  },
  keto: {
    label: "Keto",
    carbsGrams: 30,
    proteinPerKg: { abnehmen: 1.7, halten: 1.5, aufbauen: 1.8 },
    hint: "Etwa 30 g Kohlenhydrate am Tag, der Großteil der Energie kommt aus Fett.",
  },
  primal: {
    label: "Primal",
    carbsGrams: 100,
    proteinPerKg: { abnehmen: 1.8, halten: 1.6, aufbauen: 2.0 },
    hint: "Etwa 100 g Kohlenhydrate am Tag aus Obst, Gemüse und Knollen.",
  },
  carnivore: {
    label: "Carnivore",
    carbsGrams: 10,
    proteinPerKg: { abnehmen: 2.0, halten: 1.8, aufbauen: 2.2 },
    hint: "Fast keine Kohlenhydrate, Fleisch, Fisch und Eier stehen im Mittelpunkt.",
  },
};

export const ACTIVITY_FACTORS = { sitzend: 1.4, leicht: 1.55, aktiv: 1.7, "sehr-aktiv": 1.9 };
const GOAL_FACTORS = { abnehmen: 0.85, halten: 1, aufbauen: 1.1 };

const pos = (x) => Number.isFinite(x) && x > 0;
const round10 = (n) => Math.round(n / 10) * 10;

export function calcTargets(profile) {
  const p = profile;
  if (!p || typeof p !== "object") return null;
  const age = Number(p.age);
  const cm = Number(p.heightCm);
  const kg = Number(p.weightKg);
  const meals = Number(p.meals);
  if (
    (p.sex !== "w" && p.sex !== "m") ||
    !pos(age) || !pos(cm) || !pos(kg) || !pos(meals) ||
    !Object.hasOwn(ACTIVITY_FACTORS, p.activity) ||
    !Object.hasOwn(GOAL_FACTORS, p.goal) ||
    !Object.hasOwn(STYLES, p.style)
  ) {
    return null;
  }

  const warnings = [];
  const style = STYLES[p.style];
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (p.sex === "m" ? 5 : -161);
  const tdee = bmr * ACTIVITY_FACTORS[p.activity];
  const heightM = cm / 100;
  const bmi = kg / (heightM * heightM);

  let goal = p.goal;
  let factor = GOAL_FACTORS[goal];
  if (goal === "abnehmen" && bmi < 18.5) {
    goal = "halten";
    factor = 1;
    warnings.push("Dein BMI liegt unter 18,5. Es wird kein Kaloriendefizit berechnet, sondern dein Erhaltungsbedarf.");
  }
  if (goal === "abnehmen" && age < 18) {
    factor = 0.9;
    warnings.push("Unter 18 Jahren wird das Kaloriendefizit auf höchstens 10 % begrenzt.");
  }

  let kcal;
  if (tdee * factor < bmr) {
    // Mindestens der Grundumsatz, auf 10 aufgerundet, damit er nicht unterschritten wird.
    kcal = Math.ceil(bmr / 10) * 10;
    warnings.push("Die Kalorien wurden auf deinen Grundumsatz angehoben, weil weniger nicht empfehlenswert ist.");
  } else {
    kcal = round10(tdee * factor);
  }

  const refWeight = Math.min(kg, 25 * heightM * heightM);
  const protein = Math.round(style.proteinPerKg[goal] * refWeight);
  let carbs = Math.round(style.carbsGrams ?? (kcal * style.carbsPercent) / 100 / 4);
  let fat = Math.round((kcal - 4 * protein - 4 * carbs) / 9);

  const minFat = Math.ceil(0.6 * refWeight);
  if (fat < minFat) {
    fat = minFat;
    const rest = Math.round((kcal - 4 * protein - 9 * fat) / 4);
    if (rest >= 0) {
      warnings.push(`Damit genug Fett bleibt (mindestens ${minFat} g), wurden die Kohlenhydrate auf ${rest} g gekürzt.`);
      carbs = rest;
    } else {
      warnings.push(`Die Energie reicht nicht für Eiweiß und das Mindestfett von ${minFat} g. Die Kalorien liegen etwas höher als berechnet.`);
      carbs = 0;
    }
  }

  const perMeal = {
    kcal: round10(kcal / meals),
    protein: Math.round(protein / meals),
    fat: Math.round(fat / meals),
    carbs: Math.round(carbs / meals),
  };

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    kcal,
    protein,
    fat,
    carbs,
    perMeal,
    warnings,
    style: p.style,
  };
}

export function styleFit(perPortionMacros, targets) {
  const style = targets && STYLES[targets.style];
  if (!style || !targets.perMeal) return { fits: true, label: "" };
  const carbs = Number(perPortionMacros && perPortionMacros.carbs) || 0;
  const fits = carbs <= targets.perMeal.carbs * 1.1;
  return {
    fits,
    label: fits ? `passt zu ${style.label}` : `zu viele Kohlenhydrate für ${style.label}`,
  };
}
