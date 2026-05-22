import { describe, it, expect } from "vitest";

const TEST_TIMEZONE = "America/Los_Angeles";
import { addDays, differenceInCalendarDays } from "date-fns";
import {
  parseRepeat,
  computeNextDue,
  formatDateStr,
  parseDateStr,
} from "../src/rules/scheduleUtils.js";

describe("parseRepeat", () => {
  it("parses all-days repeat (daily)", () => {
    const s = parseRepeat("smtwhfa");
    expect(s).not.toBeNull();
    expect(s!.skipWeeks).toBe(0);
    expect(s!.days).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
  });

  it('parses daily shorthand "d" (alias for smtwhfa)', () => {
    const s = parseRepeat("d");
    expect(s).not.toBeNull();
    expect(s!.skipWeeks).toBe(0);
    expect(s!.days).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
  });

  it('parses "1d" — daily shorthand with skipWeeks=1', () => {
    const s = parseRepeat("1d");
    expect(s).not.toBeNull();
    expect(s!.skipWeeks).toBe(1);
    expect(s!.days).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
  });

  it('parses "2d" — daily shorthand with skipWeeks=2', () => {
    const s = parseRepeat("2d");
    expect(s).not.toBeNull();
    expect(s!.skipWeeks).toBe(2);
    expect(s!.days).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
  });

  it("parses a single-day repeat without skip weeks", () => {
    const s = parseRepeat("s");
    expect(s).not.toBeNull();
    expect(s!.skipWeeks).toBe(0);
    expect(s!.days).toEqual(new Set([0])); // Sunday
  });

  it("parses skipWeeks with a single day", () => {
    const s = parseRepeat("1s");
    expect(s).not.toBeNull();
    expect(s!.skipWeeks).toBe(1);
    expect(s!.days).toEqual(new Set([0]));
  });

  it("parses skipWeeks=2 with Sunday", () => {
    const s = parseRepeat("2s");
    expect(s).not.toBeNull();
    expect(s!.skipWeeks).toBe(2);
    expect(s!.days).toEqual(new Set([0]));
  });

  it("parses skipWeeks with multiple days", () => {
    const s = parseRepeat("3mwf");
    expect(s).not.toBeNull();
    expect(s!.skipWeeks).toBe(3);
    expect(s!.days).toEqual(new Set([1, 3, 5]));
  });

  it("returns null for invalid repeat value", () => {
    expect(parseRepeat("")).toBeNull();
    expect(parseRepeat("2")).toBeNull();
    expect(parseRepeat("xyz")).toBeNull();
    expect(parseRepeat("2x")).toBeNull();
    // "d" mixed with explicit weekday letters is not a valid form
    expect(parseRepeat("ds")).toBeNull();
    expect(parseRepeat("sd")).toBeNull();
  });
});

describe("computeNextDue", () => {
  // May 3 2026 = Sunday (getDay() = 0)
  const sunday = new Date(2026, 4, 3); // month is 0-indexed

  it("daily repeat (skipWeeks=0, all days) — next day after completion", () => {
    const schedule = parseRepeat("smtwhfa")!;
    const next = computeNextDue(sunday, schedule);
    expect(formatDateStr(next, TEST_TIMEZONE)).toBe("2026-05-04"); // Monday
  });

  it('"d" shorthand: same result as smtwhfa — next day after completion', () => {
    const schedule = parseRepeat("d")!;
    const next = computeNextDue(sunday, schedule);
    expect(formatDateStr(next, TEST_TIMEZONE)).toBe("2026-05-04"); // Monday
  });

  it('"1d" shorthand on Tuesday: next due is Monday (1 week - 1 day out)', () => {
    // Tuesday May 5 2026
    const tuesday = new Date(2026, 4, 5);
    const schedule = parseRepeat("1d")!;
    const next = computeNextDue(tuesday, schedule);
    // offset = 1*7-1 = 6; minDate = Tue May 5 + 6 = Mon May 11; first valid day = Mon May 11
    expect(formatDateStr(next, TEST_TIMEZONE)).toBe("2026-05-11");
  });

  it('"1d" shorthand on Monday: next due is Sunday (6 days out)', () => {
    // Monday May 4 2026
    const monday = new Date(2026, 4, 4);
    const schedule = parseRepeat("1d")!;
    const next = computeNextDue(monday, schedule);
    // offset = 6; minDate = Mon May 4 + 6 = Sun May 10; first valid day = Sun May 10
    expect(formatDateStr(next, TEST_TIMEZONE)).toBe("2026-05-10");
  });

  it("weekly on Sunday (skipWeeks=0): next Sunday is 7 days away", () => {
    const schedule = parseRepeat("s")!;
    const next = computeNextDue(sunday, schedule);
    expect(formatDateStr(next, TEST_TIMEZONE)).toBe("2026-05-10"); // +7 days, next Sunday
  });

  it("skipWeeks=1 on Sunday: minDate is +6 days (Saturday), next Sunday is +7", () => {
    const schedule = parseRepeat("1s")!;
    const next = computeNextDue(sunday, schedule);
    // offset = 6; minDate = Sun May 3 + 6 = Sat May 9; next Sunday >= Sat = May 10
    expect(formatDateStr(next, TEST_TIMEZONE)).toBe("2026-05-10"); // +7 days
  });

  it("skipWeeks=1 on Saturday: minDate is +6 days (Friday), next Sunday is +8", () => {
    // Saturday May 2 2026
    const saturday = new Date(2026, 4, 2);
    const schedule = parseRepeat("1s")!;
    const next = computeNextDue(saturday, schedule);
    // offset = 6; minDate = Sat May 2 + 6 = Fri May 8; next Sunday >= Fri = May 10
    expect(formatDateStr(next, TEST_TIMEZONE)).toBe("2026-05-10"); // Sunday +8 days
  });

  it("skipWeeks=0 Saturday (repeat:a): next Saturday is +7 days", () => {
    // Saturday May 2 2026, repeat:a (Saturday only)
    const saturday = new Date(2026, 4, 2);
    const schedule = parseRepeat("a")!;
    const next = computeNextDue(saturday, schedule);
    expect(formatDateStr(next, TEST_TIMEZONE)).toBe("2026-05-09"); // +7 days
  });

  it("weekday-only repeat (m–f): next weekday after a Friday", () => {
    // Friday May 1 2026
    const friday = new Date(2026, 4, 1);
    const schedule = parseRepeat("mtwhf")!;
    const next = computeNextDue(friday, schedule);
    expect(formatDateStr(next, TEST_TIMEZONE)).toBe("2026-05-04"); // Monday (skips Sat+Sun)
  });
});

describe("date helpers", () => {
  it("formatDateStr formats correctly", () => {
    expect(formatDateStr(new Date(2026, 4, 3), TEST_TIMEZONE)).toBe(
      "2026-05-03",
    );
    expect(formatDateStr(new Date(2026, 0, 1), TEST_TIMEZONE)).toBe(
      "2026-01-01",
    );
  });

  it("parseDateStr parses YYYY-MM-DD", () => {
    const d = parseDateStr("2026-05-03", TEST_TIMEZONE);
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(4); // 0-indexed
    expect(d!.getDate()).toBe(3);
  });

  it("parseDateStr returns null for invalid strings", () => {
    expect(parseDateStr("not-a-date", TEST_TIMEZONE)).toBeNull();
    expect(parseDateStr("2026/05/03", TEST_TIMEZONE)).toBeNull();
  });

  it("addDays adds calendar days", () => {
    const d = new Date(2026, 4, 3);
    expect(formatDateStr(addDays(d, 7), TEST_TIMEZONE)).toBe("2026-05-10");
    expect(formatDateStr(addDays(d, -1), TEST_TIMEZONE)).toBe("2026-05-02");
  });

  it("differenceInCalendarDays computes the difference", () => {
    const a = new Date(2026, 4, 3);
    const b = new Date(2026, 4, 17);
    expect(differenceInCalendarDays(b, a)).toBe(14);
    expect(differenceInCalendarDays(a, b)).toBe(-14);
  });
});
