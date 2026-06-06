import { addDays, format } from "date-fns";

/**
 * Weekday characters used in the `repeat:` inline field alphabet.
 * s=Sunday, m=Monday, t=Tuesday, w=Wednesday, h=Thursday, f=Friday, a=Saturday
 */
const WEEKDAY_MAP = {
  s: 0,
  m: 1,
  t: 2,
  w: 3,
  h: 4,
  f: 5,
  a: 6,
} as const;

type RepeatSchedule = {
  skipWeeks: number;
  days: Set<number>;
  isNegative: boolean;
};

/**
 * Parse a `repeat:` value into a schedule.
 *
 * Two forms are accepted:
 *
 * 1. Daily shorthand: `<skipWeeks?>d`
 *    `d` is an alias for all seven days (`smtwhfa`).
 *    Examples: "d" → every day; "1d" → skip 1 week then next day.
 *
 * 2. Explicit weekday form: `<skipWeeks?>` followed by one or more characters
 *    from the alphabet `smtwhfa` (s=Sun, m=Mon, t=Tue, w=Wed, h=Thu, f=Fri,
 *    a=Sat).
 *    Examples: "smtwhfa", "1s", "2mwf".
 *
 * Returns null if the string is not a valid repeat value.
 */
export function parseRepeat(value: string): RepeatSchedule | null {
  if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
    // Reject ISO date strings to avoid confusion with the daily shorthand.
    return null;
  }

  // Daily shorthand: optional skip-weeks prefix followed by exactly "d".
  const dailyMatch = value.match(/^-?(\d+)?d$/);
  const isNegative = value.startsWith("-");
  if (dailyMatch) {
    const skipWeeks =
      dailyMatch[1] !== undefined ? parseInt(dailyMatch[1], 10) : 0;
    return { skipWeeks, days: new Set([0, 1, 2, 3, 4, 5, 6]), isNegative };
  }

  // Explicit weekday form.
  const match = value.match(/^-?(\d+)?([smtwhfa]+)$/);
  if (!match) return null;
  const skipWeeks = match[1] !== undefined ? parseInt(match[1], 10) : 0;
  const days = new Set<number>();
  for (const ch of match[2] as unknown as Array<keyof typeof WEEKDAY_MAP>) {
    days.add(WEEKDAY_MAP[ch]);
  }
  if (days.size === 0) return null;
  return { skipWeeks, days, isNegative };
}

/**
 * Format a Date to an ISO date string "YYYY-MM-DD" in the given timezone.
 * @param date - Date or date string
 * @param timezone - IANA timezone string
 */
export function formatDateStr(date: string | Date, _timezone?: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "yyyy-MM-dd");
}

/**
 * Compute the next due date for a repeating task.
 *
 * Algorithm:
 *   offset  = skipWeeks === 0 ? 1 : skipWeeks × 7 − 1
 *   minDate = completionDate + offset
 *   newDue  = first date >= minDate whose weekday is in schedule.days
 *
 * The (n×7 − 1) offset for n > 0 keeps the schedule anchored to the same
 * weekday each cycle instead of drifting forward by one day per completion.
 * Example: repeat:1mwf completed on Monday → minDate is Sunday → next
 * Mon/Wed/Fri ≥ Sunday = Monday (same weekday, ~1 week later).
 */
export function computeNextDue(completionDate: Date, schedule: RepeatSchedule) {
  const { skipWeeks, days, isNegative } = schedule;
  const direction = isNegative ? -1 : 1;
  const offset = skipWeeks === 0 ? 1 : skipWeeks * 7 - 1;
  const nearDate = addDays(completionDate, offset * direction);
  let candidate = new Date(nearDate);
  // 400 iterations is a safe upper bound: even with a single allowed weekday
  // the gap between occurrences is at most 6 days (< 7), so we will always
  // find a match well within 7 iterations.  400 is kept as a defensive limit.
  for (let i = 0; i < 400; i++) {
    if (days.has(candidate.getDay())) {
      return candidate;
    }
    candidate = addDays(candidate, direction);
  }
  // Safety fallback — should never be reached when days is non-empty.
  return nearDate;
}
