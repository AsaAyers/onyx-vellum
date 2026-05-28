import { describe, it, expect } from "vitest";
import { createStore } from "../../src/tui/shared/store.js";

describe("createStore", () => {
  it("returns initial state", () => {
    const store = createStore<number, { type: "increment" }>({
      initial: 0,
      reducer: (s) => s + 1,
    });
    expect(store.getState()).toBe(0);
  });

  it("updates state via dispatch", () => {
    const store = createStore<number, { type: "increment" }>({
      initial: 0,
      reducer: (s) => s + 1,
    });
    store.dispatch({ type: "increment" });
    expect(store.getState()).toBe(1);
  });

  it("notifies subscribers on state change", () => {
    const store = createStore<number, { type: "increment" }>({
      initial: 0,
      reducer: (s) => s + 1,
    });
    const spy = { fn: () => {} };
    const calls: number[] = [];
    const orig = spy.fn;
    spy.fn = () => calls.push(store.getState());
    store.subscribe(spy.fn);
    store.dispatch({ type: "increment" });
    expect(calls).toEqual([1]);
    spy.fn = orig;
  });

  it("does not notify subscriber when state is unchanged (same reference)", () => {
    let calls = 0;
    const store = createStore<{ value: number }, { type: "noop" }>({
      initial: { value: 0 },
      reducer: (s) => s,
    });
    store.subscribe(() => calls++);
    store.dispatch({ type: "noop" });
    expect(calls).toBe(0);
    expect(store.getState()).toEqual({ value: 0 });
  });

  it("unsubscribes listener", () => {
    const store = createStore<number, { type: "increment" }>({
      initial: 0,
      reducer: (s) => s + 1,
    });
    let calls = 0;
    const unsub = store.subscribe(() => calls++);
    unsub();
    store.dispatch({ type: "increment" });
    expect(calls).toBe(0);
  });

  it("supports multiple subscribers", () => {
    const store = createStore<number, { type: "increment" }>({
      initial: 0,
      reducer: (s) => s + 1,
    });
    let a = 0;
    let b = 0;
    store.subscribe(() => a++);
    store.subscribe(() => b++);
    store.dispatch({ type: "increment" });
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});
