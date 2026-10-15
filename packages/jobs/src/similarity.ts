/** Calibration of cosine → 0–100 pre-judge score (research R7; checked by the labelled eval). */
export const SIM_FLOOR = 0.35;
export const SIM_SPAN = 0.4;

export function similarityToScore(cos: number): number {
  return Math.round(Math.min(1, Math.max(0, (cos - SIM_FLOOR) / SIM_SPAN)) * 100);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
