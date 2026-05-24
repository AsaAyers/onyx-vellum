import { zUserLocalTime } from "../src/engine/timezone.js";

// Pin the date so the test produces the same output regardless of when it runs.
export const testDate = zUserLocalTime.parse({
  tz: "UTC",
  strDate: "2026-05-03",
});
