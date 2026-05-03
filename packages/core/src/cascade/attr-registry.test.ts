import { describe, it, expect } from "vitest";
import type { AttrInterpreter } from "./attr-registry";

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
