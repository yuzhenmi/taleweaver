import { describe, it, expect } from "vitest";
import { createIntrinsicSizesCache } from "./intrinsic-sizes";

describe("IntrinsicSizesCache", () => {
  it("get returns undefined for missing keys", () => {
    const cache = createIntrinsicSizesCache();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("set then get roundtrips", () => {
    const cache = createIntrinsicSizesCache();
    cache.set("k", { minContent: 10, maxContent: 100, firstCluster: 10, restMin: 0 });
    expect(cache.get("k")).toEqual({ minContent: 10, maxContent: 100, firstCluster: 10, restMin: 0 });
  });

  it("invalidate removes a key", () => {
    const cache = createIntrinsicSizesCache();
    cache.set("k", { minContent: 10, maxContent: 100, firstCluster: 10, restMin: 0 });
    cache.invalidate("k");
    expect(cache.get("k")).toBeUndefined();
  });

  it("clear removes all keys", () => {
    const cache = createIntrinsicSizesCache();
    cache.set("a", { minContent: 1, maxContent: 2, firstCluster: 1, restMin: 0 });
    cache.set("b", { minContent: 3, maxContent: 4, firstCluster: 3, restMin: 0 });
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("re-set overwrites", () => {
    const cache = createIntrinsicSizesCache();
    cache.set("k", { minContent: 10, maxContent: 100, firstCluster: 10, restMin: 0 });
    cache.set("k", { minContent: 20, maxContent: 200, firstCluster: 20, restMin: 0 });
    expect(cache.get("k")).toEqual({ minContent: 20, maxContent: 200, firstCluster: 20, restMin: 0 });
  });
});
