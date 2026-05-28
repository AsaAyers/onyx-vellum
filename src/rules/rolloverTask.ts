import { addDays, differenceInCalendarDays } from "date-fns";
import { format, toZonedTime } from "date-fns-tz";
import { parseRepeat, computeNextDue } from "./scheduleUtils.js";

export type RolloverResult = {
  clone: Record<string, string>;
  stripOriginal: boolean;
} | null;

/**
 * Pure function: given the inline fields of a completed repeating task and the
 * date it was completed, compute the fields for the cloned (next occurrence)
 * task. Returns null when the task should not roll over (no repeat, no done
 * date, or invalid repeat schedule).
 */
export function rolloverTask(
  fields: Record<string, string>,
  doneDate: Date,
  tz: string,
): RolloverResult {
  if (!fields.repeat || !fields.done) return null;

  const schedule = parseRepeat(fields.repeat);
  if (!schedule) return null;

  const newDue = computeNextDue(doneDate, schedule);
  const cloneFields: Record<string, string> = {};

  const oldDueDate = fields.due ? parseDateInTz(fields.due, tz) : null;
  const oldDue = oldDueDate ?? doneDate;
  const deltaDays = differenceInCalendarDays(newDue, oldDue);

  if (fields.sleep) {
    const sleepDate = parseDateInTz(fields.sleep, tz);
    if (sleepDate) {
      const newSleep = addDays(sleepDate, deltaDays);
      cloneFields.sleep = formatDateInTz(newSleep, tz);
    }
  }

  cloneFields.due = formatDateInTz(newDue, tz);
  cloneFields.repeat = fields.repeat;

  return { clone: cloneFields, stripOriginal: true };
}

/** Parse a YYYY-MM-DD date string in a timezone to a Date at noon. */
export function parseDateInTz(strDate: string, tz: string): Date | null {
  try {
    const parts = strDate.split("-");
    if (parts.length !== 3) return null;
    const [year, month, day] = parts.map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = toZonedTime(strDate, tz);
    date.setFullYear(year, month - 1, day);
    date.setHours(12, 0, 0, 0);
    // Verify the date didn't roll over (e.g. Feb 30 -> Mar 2)
    if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  } catch {
    return null;
  }
}

function formatDateInTz(d: Date, tz: string): string {
  return format(d, "yyyy-MM-dd", { timeZone: tz });
}
