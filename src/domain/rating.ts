/**
 * Rating arithmetic.
 *
 * Averages are rounded once, here, so the API, the page and any future export cannot disagree about
 * what a 3.25 displays as.
 */

export type StarCount = { stars: number; count: number };

export const MEALS = ["breakfast", "lunch", "snacks", "dinner"] as const;
export type Meal = (typeof MEALS)[number];

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snacks: "Evening snacks",
  dinner: "Dinner",
};

/** Mean of the given stars to one decimal place, or null when nobody has rated yet. */
export function averageStars(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

export function roundToOneDecimal(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

/** Counts for stars 1 to 5, always five entries, so a chart never has gaps. */
export function starDistribution(values: readonly number[]): StarCount[] {
  const counts = new Map<number, number>([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
  ]);
  for (const value of values) {
    if (counts.has(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].map(([stars, count]) => ({ stars, count }));
}

/** Plain-language verdict for a score, used in headings so the number is not the only signal. */
export function scoreVerdict(average: number | null): string {
  if (average === null) return "Not rated yet";
  if (average >= 4.5) return "Excellent";
  if (average >= 3.5) return "Good";
  if (average >= 2.5) return "Average";
  if (average >= 1.5) return "Poor";
  return "Very poor";
}

/** Percentage width for a bar, 0 to 100, from a 1 to 5 score. */
export function starsAsPercent(average: number | null): number {
  if (average === null) return 0;
  return Math.max(0, Math.min(100, Math.round((average / 5) * 100)));
}
