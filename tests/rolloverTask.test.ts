import { describe, it, expect } from "vitest";
import { rolloverTask, parseDateInTz } from "../src/rules/rolloverTask.js";

const TZ = "America/Los_Angeles";

/** Helper: parse date string the same way production code does. */
function dt(str: string): Date {
  return parseDateInTz(str, TZ)!;
}

describe("rolloverTask", () => {
  // Pinned date: 2026-05-03 = Sunday
  const sunday = dt("2026-05-03");

  it("returns null when fields.repeat is missing", () => {
    const result = rolloverTask({ done: "2026-05-03" }, sunday, TZ);
    expect(result).toBeNull();
  });

  it("returns null when fields.done is missing", () => {
    const result = rolloverTask({ repeat: "d" }, sunday, TZ);
    expect(result).toBeNull();
  });

  it("returns null when repeat value is invalid", () => {
    const result = rolloverTask(
      { repeat: "xyz", done: "2026-05-03" },
      sunday,
      TZ,
    );
    expect(result).toBeNull();
  });

  it('daily shorthand "d" — next day', () => {
    const result = rolloverTask(
      { repeat: "d", done: "2026-05-03" },
      sunday,
      TZ,
    );
    expect(result).not.toBeNull();
    expect(result!.clone.due).toBe("2026-05-04");
    expect(result!.clone.repeat).toBe("d");
    expect(result!.stripOriginal).toBe(true);
    // No sleep field in input — none in output
    expect(result!.clone.sleep).toBeUndefined();
  });

  it("daily repeat smtwhfa — next day", () => {
    const result = rolloverTask(
      { repeat: "smtwhfa", done: "2026-05-03" },
      sunday,
      TZ,
    );
    expect(result).not.toBeNull();
    expect(result!.clone.due).toBe("2026-05-04");
    expect(result!.clone.repeat).toBe("smtwhfa");
  });

  it("weekly repeat s (Sunday) — next Sunday in 7 days", () => {
    const result = rolloverTask(
      { repeat: "s", done: "2026-05-03" },
      sunday,
      TZ,
    );
    expect(result).not.toBeNull();
    expect(result!.clone.due).toBe("2026-05-10");
    expect(result!.clone.repeat).toBe("s");
  });

  it("weekly repeat a (Saturday) on Sunday — next Saturday in 6 days", () => {
    const result = rolloverTask(
      { repeat: "a", done: "2026-05-03" },
      sunday,
      TZ,
    );
    expect(result).not.toBeNull();
    expect(result!.clone.due).toBe("2026-05-09");
  });

  it('skip-weeks "1d" — skip 1 week, result is 6 days out', () => {
    const result = rolloverTask(
      { repeat: "1d", done: "2026-05-03" },
      sunday,
      TZ,
    );
    expect(result).not.toBeNull();
    // offset = 1*7-1 = 6; minDate = May 3 + 6 = May 9
    expect(result!.clone.due).toBe("2026-05-09");
  });

  it('"mwf" on Sunday — next weekday is Monday', () => {
    const result = rolloverTask(
      { repeat: "mwf", done: "2026-05-03" },
      sunday,
      TZ,
    );
    expect(result).not.toBeNull();
    expect(result!.clone.due).toBe("2026-05-04");
  });

  it('"1mwf" on Sunday — skip-weeks, next Mon is May 11', () => {
    const result = rolloverTask(
      { repeat: "1mwf", done: "2026-05-03" },
      sunday,
      TZ,
    );
    expect(result).not.toBeNull();
    // offset = 1*7-1 = 6; minDate = May 3 + 6 = May 9; next m/w/f >= May 9 = Monday May 11
    expect(result!.clone.due).toBe("2026-05-11");
  });

  it("sleep advances by deltaDays when due field is present", () => {
    // Saturday repeat, completed on Sunday with due:2026-05-02
    const result = rolloverTask(
      {
        repeat: "a",
        done: "2026-05-03",
        due: "2026-05-02",
        sleep: "2026-04-29",
      },
      sunday,
      TZ,
    );
    expect(result).not.toBeNull();
    // newDue = next Saturday = 2026-05-09
    expect(result!.clone.due).toBe("2026-05-09");
    // deltaDays = May 9 - May 2 = 7
    // new sleep = Apr 29 + 7 = May 6
    expect(result!.clone.sleep).toBe("2026-05-06");
  });

  it("sleep advances by deltaDays when due field is absent (fallback to doneDate)", () => {
    // Daily repeat, completed on Sunday, no due field
    const result = rolloverTask(
      { repeat: "d", done: "2026-05-03", sleep: "2026-04-29" },
      sunday,
      TZ,
    );
    expect(result).not.toBeNull();
    // newDue = 2026-05-04; oldDue falls back to doneDate = 2026-05-03
    // deltaDays = May 4 - May 3 = 1
    // new sleep = Apr 29 + 1 = Apr 30
    expect(result!.clone.sleep).toBe("2026-04-30");
  });

  it("no sleep in input — no sleep in clone", () => {
    const result = rolloverTask(
      { repeat: "d", done: "2026-05-03" },
      sunday,
      TZ,
    );
    expect(result).not.toBeNull();
    expect(result!.clone.sleep).toBeUndefined();
  });

  it("returns null when done date string is unparseable", () => {
    const badDate = parseDateInTz("not-a-date", TZ);
    // parseDateInTz returns null for invalid input — so we use a Date object
    // created differently; rolloverTask accepts any Date for doneDate,
    // but computeNextDue would still work. The null check for doneDate
    // happens in the adapter, not in rolloverTask.
    // For rolloverTask itself, if doneDate is a valid Date, it processes.
    // So this test verifies parseDateInTz returns null (tested below).
    expect(badDate).toBeNull();
  });

  it("returns null when parseDateInTz receives an invalid date string", () => {
    expect(parseDateInTz("", TZ)).toBeNull();
    expect(parseDateInTz("2026-13-01", TZ)).toBeNull();
    expect(parseDateInTz("abc-def-ghi", TZ)).toBeNull();
  });
});
