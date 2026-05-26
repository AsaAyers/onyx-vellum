/**
 * Schedule-based alert runner for watch mode.
 *
 * createAlertScheduler sets up a recurring interval check. On each tick,
 * `getSchedule` is called to obtain the list of "HH:MM" times at which the
 * alert should fire. If the current local-clock HH:MM is in that list and has
 * not already fired in this minute window, `onAlert` is invoked.
 */

import { userLocalTime } from "./userLocalTime.js";
import createDebug from "debug";

const debug = createDebug("onyx:scheduler");

// eslint-disable-next-line no-console
const log = console.log.bind(console);

/**
 * Start a recurring schedule check.
 *
 * @param getSchedule  Called on every check interval; returns the current list
 *                     of "HH:MM" times (24-hour clock, local time) at which the
 *                     alert should fire. Returning an empty array disables the
 *                     alert entirely.
 * @param onAlert      Async callback invoked when the current time is in the
 *                     schedule.  Errors are caught and logged to the console.
 * @param intervalMs   Check period in milliseconds. Defaults to 60 000 (1 min).
 * @returns            A stop function — call it to cancel the interval.
 */
export function normalizeAlertSchedule(schedule: string[]): {
  valid: string[];
  invalid: string[];
} {
  const valid = new Set<string>();
  const invalid: string[] = [];

  for (const value of schedule) {
    const match = /^\s*(\d{1,2}):(\d{1,2})\s*$/.exec(value);
    if (!match) {
      invalid.push(value);
      continue;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (
      !Number.isInteger(hours) ||
      !Number.isInteger(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      invalid.push(value);
      continue;
    }
    valid.add(
      `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    );
  }

  return { valid: [...valid], invalid };
}

export function createAlertScheduler(
  getSchedule: () => string[],
  onAlert: () => Promise<void>,
  tz: string,
  options?: {
    intervalMs?: number;
  },
): () => void {
  const intervalMs = options?.intervalMs ?? 60_000;
  // Track the last fired "YYYY-MM-DDTHH:MM" to prevent double-firing within
  // the same minute window while still allowing the same time on a future day.
  let lastFiredKey = "";

  const check = (): void => {
    const schedule = normalizeAlertSchedule(getSchedule()).valid;
    debug(`Current alert schedule: ${schedule.join(", ")}`);
    if (schedule.length === 0) return;

    const now = userLocalTime({ tz: tz || "UTC" }).date;
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const currentMinute = `${hh}:${mm}`;

    debug(
      `Checking alert schedule at ${currentMinute} (schedule: ${!schedule.includes(currentMinute)})`,
    );
    if (!schedule.includes(currentMinute)) return;

    const yyyy = String(now.getFullYear());
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const firedKey = `${yyyy}-${mo}-${dd}T${currentMinute}`;

    debug({ firedKey, lastFiredKey });
    if (firedKey !== lastFiredKey) {
      lastFiredKey = firedKey;
      log(`[watch] Alert schedule: firing at ${currentMinute}`);
      onAlert().catch((err: unknown) => {
        console.error(
          "[watch] Error running scheduled alert:",
          (err as Error).message,
        );
      });
    }
  };

  check();
  const timer = setInterval(check, intervalMs);

  return (): void => {
    clearInterval(timer);
  };
}
