import z from "zod";
import { format, toZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";

const zTimeInput = z.object({
  strDate: z.string().optional(),
  tz: z.string(),
  noon: z.boolean().default(true),
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

        const { strDate, tz, noon } = input.data;
        const toISO = (d: Date) => format(d, "yyyy-MM-dd", { timeZone: tz });

        const date = toZonedTime(strDate || new Date(), tz);
        if (noon === true) {
          date.setHours(12, 0, 0, 0); // Set to noon in the specified timezone
        }
        const today = toISO(date);
        const yesterday = toISO(addDays(date, -1));
        const tomorrow = toISO(addDays(date, 1));

        return { date, today, yesterday, tomorrow, tz };
      },
      zTimeOutput,
      zTimeInput,
    ),
  )
  .brand("UserNoon");

export type UserNoon = z.infer<typeof zUserLocalTime>;
