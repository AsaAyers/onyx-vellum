import z from "zod";
import { format, toZonedTime, toDate } from "date-fns-tz";
import { addDays } from "date-fns";
import createDebug from "debug";
import { parseRepeat, computeNextDue } from "../rules/scheduleUtils.js";

const debug = createDebug("onyx:timezone");

const zTimeInput = z.strictObject({
  strDate: z.string().optional(),
  tz: z.string(),
});

const zTimeOutput = z.object({
  date: z.date(),
  today: z.string(),
  tz: z.string(),
  resolve: z
    .function()
    .args(z.string())
    .returns(z.union([z.string(), z.null()])),
});
export const zUserLocalTime = zTimeInput
  .pipe(
    z.preprocess(
      (i, ctx): z.infer<typeof zTimeOutput> => {
        const input = zTimeInput.safeParse(i);
        if (!input.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.invalid_type,
            expected: "object",
            received: typeof i,
            message: input.error.message,
          });
          return z.NEVER;
        }

        const { strDate, tz } = input.data;
        const toISO = (d: Date) => format(d, "yyyy-MM-dd", { timeZone: tz });

        const now = toDate(new Date(), { timeZone: tz });
        const dateInput = strDate ?? now;

        const date = toZonedTime(dateInput, tz);
        if (strDate) {
          const [year, month, day] = strDate.split("-").map(Number);
          date.setFullYear(year, month - 1, day);
          date.setHours(12, 0, 0, 0);
        }
        const today = toISO(date);
        debug(
          "Parsed user local time",
          JSON.stringify({ strDate, date, today, tz }),
        );
        const yesterday = toISO(addDays(date, -1));
        const tomorrow = toISO(addDays(date, 1));

        if (strDate && strDate !== today) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provided date is not today in the specified timezone",
            params: { strDate, today, date },
          });
          return z.NEVER;
        }

        function resolve(value: string): string | null {
          switch (value.trim().toLowerCase()) {
            case "today":
              return today;
            case "yesterday":
              return yesterday;
            case "tomorrow":
              return tomorrow;
            default:
          }

          const schedule = parseRepeat(value);
          if (!schedule) return null;
          const newDue = computeNextDue(date, schedule);
          return toISO(newDue);
        }

        return { date, today, tz, resolve };
      },
      zTimeOutput,
      zTimeInput,
    ),
  )
  .brand("UserNoon");

export type UserLocalTime = z.infer<typeof zUserLocalTime>;

export const userLocalTime = (
  input: z.input<typeof zUserLocalTime>,
): UserLocalTime => zUserLocalTime.parse(input);
