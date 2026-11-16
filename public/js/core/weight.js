// Gewichtsverlauf. Datumsrechnung über UTC, damit keine Zeitzone oder Sommerzeit stört.

const DAY_MS = 86400000;

function dayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS : NaN;
}

const valid = (e) => e && Number.isFinite(dayNumber(e.date)) && Number.isFinite(Number(e.kg));
const round = (n, digits) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f || 0;
};

export function sortEntries(entries) {
  return (entries || [])
    .filter(valid)
    .map((e) => ({ date: e.date, kg: Number(e.kg) }))
    .sort((a, b) => dayNumber(a.date) - dayNumber(b.date));
}

export function movingAverage(entries, days = 7) {
  const sorted = sortEntries(entries);
  const span = Math.max(1, Math.floor(Number(days) || 1));
  return sorted.map((e) => {
    const end = dayNumber(e.date);
    const inWindow = sorted.filter((o) => {
      const d = dayNumber(o.date);
      return d <= end && d >= end - (span - 1);
    });
    const mean = inWindow.reduce((s, o) => s + o.kg, 0) / inWindow.length;
    return { date: e.date, kg: round(mean, 2) };
  });
}

// Steigung der Ausgleichsgeraden in kg je Woche über die letzten 28 Tage.
function weeklyRate(sorted) {
  const last = dayNumber(sorted[sorted.length - 1].date);
  const pts = sorted
    .map((e) => ({ x: dayNumber(e.date) - last, y: e.kg }))
    .filter((p) => p.x > -28);
  if (pts.length < 2) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  return round((sxy / sxx) * 7, 2);
}

// toGoal = Zielgewicht − aktuell (negativ: noch abnehmen), gleiche Vorzeichenlogik wie change.
export function weightStats(entries, profile) {
  const sorted = sortEntries(entries);
  if (sorted.length === 0) return null;
  const start = sorted[0].kg;
  const current = sorted[sorted.length - 1].kg;
  const cm = Number(profile && profile.heightCm);
  const goal = profile && profile.goalWeightKg;
  const bmi = cm > 0 ? round(current / (cm / 100) ** 2, 1) : null;
  const toGoal =
    goal !== null && goal !== undefined && Number.isFinite(Number(goal)) && Number(goal) > 0
      ? round(Number(goal) - current, 2)
      : null;
  return {
    start,
    current,
    change: round(current - start, 2),
    bmi,
    weeklyRate: sorted.length < 2 ? null : weeklyRate(sorted),
    toGoal,
  };
}
