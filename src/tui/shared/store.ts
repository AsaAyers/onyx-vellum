export function createStore<State, Event>(config: {
  initial: State;
  reducer: (state: State, event: Event) => State;
}) {
  let state = config.initial;
  const listeners = new Set<() => void>();

  return {
    getState: (): State => state,
    dispatch: (event: Event) => {
      const next = config.reducer(state, event);
      if (next !== state) {
        state = next;
        listeners.forEach((fn) => fn());
      }
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type Store<State, Event> = ReturnType<typeof createStore<State, Event>>;
