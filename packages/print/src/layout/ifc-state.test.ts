import { describe, it, expect } from "vitest";
import { createIFCStateCache, type IFCState } from "./ifc-state";

describe("IFCStateCache", () => {
  function makeState(): IFCState {
    return {
      tokens: [], lines: [], availableInlineSize: 500,
      textAlign: "start", direction: "ltr", textIndent: 0,
      tabStops: [], defaultTabStop: 48, hasTab: false,
    };
  }

  it("IFCState carries tabStops/defaultTabStop/hasTab", () => {
    const s: IFCState = {
      tokens: [], lines: [], availableInlineSize: 100,
      textAlign: "start", direction: "ltr", textIndent: 0,
      tabStops: [], defaultTabStop: 48, hasTab: false,
    };
    expect(s.hasTab).toBe(false);
  });

  it("get returns undefined for missing keys", () => {
    const cache = createIFCStateCache();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("set then get roundtrips", () => {
    const cache = createIFCStateCache();
    const s = makeState();
    cache.set("k", s);
    expect(cache.get("k")).toBe(s);
  });

  it("invalidate removes a key", () => {
    const cache = createIFCStateCache();
    cache.set("k", makeState());
    cache.invalidate("k");
    expect(cache.get("k")).toBeUndefined();
  });

  it("clear removes all keys", () => {
    const cache = createIFCStateCache();
    cache.set("a", makeState());
    cache.set("b", makeState());
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("re-set overwrites", () => {
    const cache = createIFCStateCache();
    const s1 = makeState();
    const s2 = makeState();
    cache.set("k", s1);
    cache.set("k", s2);
    expect(cache.get("k")).toBe(s2);
  });
});
