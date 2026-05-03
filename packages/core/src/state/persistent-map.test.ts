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

  it("delete returns a new map without the key, original unchanged", () => {
    const m1 = createPersistentMap<string, number>().set("a", 1).set("b", 2);
    const m2 = m1.delete("a");
    expect(m1.has("a")).toBe(true);
    expect(m1.size).toBe(2);
    expect(m2.has("a")).toBe(false);
    expect(m2.has("b")).toBe(true);
    expect(m2.size).toBe(1);
  });

  it("delete on missing key returns an equivalent map (no-op semantics)", () => {
    const m = createPersistentMap<string, number>().set("a", 1);
    const m2 = m.delete("missing");
    expect(m2.size).toBe(1);
    expect(m2.get("a")).toBe(1);
  });

  it("entries / keys / values iterate the contents", () => {
    const m = createPersistentMap<string, number>().set("a", 1).set("b", 2);
    expect([...m.keys()].sort()).toEqual(["a", "b"]);
    expect([...m.values()].sort()).toEqual([1, 2]);
    expect([...m.entries()].sort()).toEqual([["a", 1], ["b", 2]]);
  });
});
