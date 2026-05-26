/** A glob-pattern source (relative to vaultPath). */
export type GlobSource = {
  type: "glob";
  pattern: string;
  /**
   * Glob patterns (relative to vaultPath) for files to exclude from the
   * source.  A file is excluded if it matches any pattern in this list.
   * Supports the same syntax as `pattern`.
   */
  exclude?: string[];
};
/** A concrete relative-path source. */
export type PathSource = { type: "path"; value: string };
export type Source = GlobSource | PathSource;
