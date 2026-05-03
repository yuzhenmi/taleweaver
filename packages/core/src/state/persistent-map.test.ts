import { describe, it, expect } from "vitest";
import { createPersistentMap } from "./persistent-map";

describe("persistent-map", () => {
  it("creates an empty map", () => {
    const m = createPersistentMap<string, number>();
    expect(m.size).toBe(0);
    expect(m.has("a")).toBe(false);
    expect(m.get("a")).toBeUndefined();
  });

  it("set returns a new map with the value set, original unchanged", () => {
    const m1 = createPersistentMap<string, number>();
    const m2 = m1.set("a", 1);
    expect(m1.has("a")).toBe(false);
    expect(m1.size).toBe(0);
    expect(m2.has("a")).toBe(true);
    expect(m2.get("a")).toBe(1);
    expect(m2.size).toBe(1);
  });

  it("set on existing key replaces the value", () => {
    const m = createPersistentMap<string, number>().set("a", 1).set("a", 2);
    expect(m.get("a")).toBe(2);
    expect(m.size).toBe(1);
  });

  it("get returns undefined for missing keys", () => {
    const m = createPersistentMap<string, number>().set("a", 1);
    expect(m.get("missing")).toBeUndefined();
  });
});
