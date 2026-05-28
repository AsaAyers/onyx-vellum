export function fuzzyMatch(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

export function filterFiles(
  files: string[],
  query: string,
): string[] {
  if (query === "") return files;
  const lower = query.toLowerCase();
  return files.filter((f) => fuzzyMatch(lower, f.toLowerCase()));
}
