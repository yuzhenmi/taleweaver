import { describe, it, expect } from "vitest";
import type { AttrInterpreter } from "./attr-registry";
import { AttrRegistry } from "./attr-registry";

describe("AttrInterpreter type", () => {
  it("can be implemented with the minimal required fields", () => {
    const i: AttrInterpreter = {
      attrKey: "bold",
      toStyle: (value) => (value ? { fontWeight: "bold" } : {}),
    };
    expect(i.attrKey).toBe("bold");
    expect(i.toStyle(true)).toEqual({ fontWeight: "bold" });
    expect(i.toStyle(false)).toEqual({});
  });

  it("can include an optional equals function", () => {
    const i: AttrInterpreter = {
      attrKey: "comment",
      toStyle: () => ({}),
      equals: (a, b) => (a as { id: string }).id === (b as { id: string }).id,
    };
    expect(i.equals?.({ id: "c1", timestamp: 1 }, { id: "c1", timestamp: 2 })).toBe(true);
    expect(i.equals?.({ id: "c1" }, { id: "c2" })).toBe(false);
  });
});

describe("AttrRegistry", () => {
  it("starts empty", () => {
    const r = new AttrRegistry();
    expect(r.has("bold")).toBe(false);
    expect(r.get("bold")).toBeUndefined();
  });

  it("registers and retrieves an interpreter", () => {
    const r = new AttrRegistry();
    const i: AttrInterpreter = {
      attrKey: "bold",
      toStyle: (v) => (v ? { fontWeight: "bold" } : {}),
    };
    r.register(i);
    expect(r.has("bold")).toBe(true);
    expect(r.get("bold")).toBe(i);
  });

  it("re-registering the same key replaces the previous interpreter", () => {
    const r = new AttrRegistry();
    const i1: AttrInterpreter = { attrKey: "bold", toStyle: () => ({}) };
    const i2: AttrInterpreter = { attrKey: "bold", toStyle: () => ({ fontWeight: "bold" }) };
    r.register(i1);
    r.register(i2);
    expect(r.get("bold")).toBe(i2);
  });
});
