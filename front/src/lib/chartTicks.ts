/**
 * Which points of a series get a label on the time axis — evenly spread, both ends included.
 *
 * Indices rather than instants, so the label is always the start of a real interval of the series
 * and never an instant between two of them. Fewer points than ticks labels every point; one point
 * labels that one; none labels nothing.
 */
export const tickIndices = (count: number, ticks: number): number[] => {
  if (count <= 0 || ticks <= 0) return [];
  if (count <= ticks) return Array.from({ length: count }, (_, i) => i);
  if (ticks === 1) return [0];

  const step = (count - 1) / (ticks - 1);
  return Array.from({ length: ticks }, (_, i) => Math.round(i * step));
};
