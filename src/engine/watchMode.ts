export const ALERT_RULE = "incompleteTaskAlert";
export const FAST_PATH_RULE_NAMES = ["ensureAudioTranscripts"];
export const FAST_PATH_DEBOUNCE_MS = 1_000;

export function selectWatchRuleSets(availableRuleNames: string[]): {
  allFileChangeRuleNames: string[];
  fastPathRuleNames: string[];
} {
  const fastPathRuleSet = new Set<string>(FAST_PATH_RULE_NAMES);

  return {
    // Scheduled alert runs separately; all other selected rules run on the
    // normal debounce window.
    allFileChangeRuleNames: availableRuleNames.filter((n) => n !== ALERT_RULE),
    // Fast-path is a fixed (non-configurable) subset of rules.
    fastPathRuleNames: availableRuleNames.filter((n) => fastPathRuleSet.has(n)),
  };
}

export function createStopAll(stops: Array<() => void>): () => void {
  return (): void => {
    for (const stop of stops) {
      stop();
    }
  };
}
