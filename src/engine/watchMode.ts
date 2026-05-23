export function createStopAll(stops: Array<() => void>): () => void {
  return (): void => {
    for (const stop of stops) {
      stop();
    }
  };
}
