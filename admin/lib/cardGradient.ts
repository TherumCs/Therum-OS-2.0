// Deterministic per-card gradient — matches 1.9.44's default "Gradient" card
// image source (Therum_Card_Style::image_source() default) for content that
// has no cover image set. Same id always gets the same gradient.
const PAIRS: [string, string][] = [
  ['#10b981', '#0d9488'],
  ['#ec4899', '#a21caf'],
  ['#6366f1', '#4338ca'],
  ['#0ea5e9', '#0369a1'],
  ['#f97316', '#b91c1c'],
  ['#14b8a6', '#155e75'],
  ['#8b5cf6', '#6d28d9'],
  ['#f43f5e', '#be123c'],
];

export function cardGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const [from, to] = PAIRS[hash % PAIRS.length]!;
  return `linear-gradient(135deg, ${from}, ${to})`;
}
