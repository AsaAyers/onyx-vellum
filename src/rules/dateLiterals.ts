import type { UserLocalTime } from "../engine/userLocalTime.js";

export const DATE_KEYS = ["due", "sleep", "done"] as const;

export const RELATIVE_DATE_LITERALS = [
  "today",
  "yesterday",
  "tomorrow",
] as const;

type RelativeDateContext = Pick<
  UserLocalTime,
  "today" | "yesterday" | "tomorrow"
>;

export function resolveRelativeDateLiteral(
  value: string,
  dates: RelativeDateContext,
): string | undefined {
  switch (value.trim().toLowerCase()) {
    case "today":
      return dates.today;
    case "yesterday":
      return dates.yesterday;
    case "tomorrow":
      return dates.tomorrow;
    default:
      return undefined;
  }
}
