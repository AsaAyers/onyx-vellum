import z from "zod";
import { format, toZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";
import createDebug from "debug";

const debug = createDebug("onyx:timezone");

const zTimeInput = z.strictObject({
  strDate: z.string().optional(),
  tz: z.string(),
});

const zTimeOutput = z.object({
  date: z.date(),
  today: z.string(),
  yesterday: z.string(),
  tomorrow: z.string(),
  tz: z.string(),
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

        const now = toZonedTime(new Date(), tz);
        if (strDate) {
          const [year, month, day] = strDate.split("-").map(Number);
          now.setFullYear(year, month - 1, day);
        }

        const dateInput = strDate ?? new Date();
        const date = toZonedTime(dateInput, tz);
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
            params: { strDate, today },
          });
          return z.NEVER;
        }
        return { date, today, yesterday, tomorrow, tz };
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
