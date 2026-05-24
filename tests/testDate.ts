import { userLocalTime } from "../src/engine/timezone.js";

// Pin the date so the test produces the same output regardless of when it runs.
export const testDate = userLocalTime({
  tz: "America/Los_Angeles",
  strDate: "2026-05-03",
});
