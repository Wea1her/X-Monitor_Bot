export function getBackoffDelayMs(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  const jitter = 0.8 + Math.random() * 0.4;
  return base * jitter;
}
