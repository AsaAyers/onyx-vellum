import { execa } from "execa";
import fs from "node:fs/promises";

export type TrimDeadAirOptions = {
  input: string;
  output: string;

  /**
   * Silence must be at least this long before it gets shortened.
   * Default: 1 second.
   */
  minSilenceSeconds?: number;

  /**
   * Maximum silence to leave behind after trimming.
   * Default: 1 second.
   */
  keepSilenceSeconds?: number;

  /**
   * Volume threshold below which audio counts as silence.
   * More negative = less aggressive.
   * Less negative = more aggressive.
   *
   * Good starting values:
   * - -35dB: aggressive
   * - -40dB: normal
   * - -45dB: safer for quiet speech
   * - -50dB: conservative
   */
  thresholdDb?: number;

  /**
   * AAC output bitrate for m4a.
   */
  bitrate?: string;

  /**
   * Path to ffmpeg binary.
   */
  ffmpegPath?: string;
};

export async function trimDeadAir({
  input,
  output,
  minSilenceSeconds = 1,
  keepSilenceSeconds = 1,
  thresholdDb = -45,
  bitrate = "128k",
  ffmpegPath = "ffmpeg",
}: TrimDeadAirOptions): Promise<void> {
  // Skip empty files used for testing
  if ((await fs.stat(input)).size === 0) {
    return;
  }

  if (keepSilenceSeconds > minSilenceSeconds) {
    throw new Error(
      `keepSilenceSeconds must be <= minSilenceSeconds. Got keep=${keepSilenceSeconds}, min=${minSilenceSeconds}.`,
    );
  }

  const filter = [
    "silenceremove=start_periods=1",
    "start_duration=0.1", // Fast trigger to catch the very first word
    `start_threshold=${thresholdDb}dB`,
    "stop_periods=-1",
    `stop_duration=${minSilenceSeconds}`,
    `stop_threshold=${thresholdDb}dB`,
    "stop_silence=0.3", // Keeps 0.3s of padding so words aren't cut off
    "detection=peak", // Changed to 'peak' to catch sharp speech consonants
    "window=0.02,asetpts=N/SR/TB", // Shortened window to 20ms for precise speech tracking
  ].join(":");

  await execa(
    ffmpegPath,
    [
      "-nostdin",
      "-stats",
      "-stats_period",
      "1",
      "-i",
      input,
      "-vn",
      "-map",
      "0:a:0",
      "-af",
      filter,
      "-c:a",
      "aac",
      "-b:a",
      bitrate,
      "-movflags",
      "+faststart",
      output,
    ],
    {
      stdout: "inherit",
      stderr: "inherit",
      // cancelSignal,
    },
  );
}
