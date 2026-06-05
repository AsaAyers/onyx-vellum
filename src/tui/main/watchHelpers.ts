export function computeDebounceDelay(
  baseMs: number,
  growthFactor: number,
  callCount: number,
  maxMs: number,
): number {
  return Math.min(
    maxMs,
    Math.round(baseMs * Math.pow(growthFactor, callCount - 1)),
  );
}

export function computeDebounceRemaining(
  since: number,
  delayMs: number,
  now: number,
): number {
  const elapsed = now - since;
  return Math.max(0, delayMs - elapsed);
}
