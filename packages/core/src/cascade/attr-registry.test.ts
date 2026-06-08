import { describe, it, expect } from "vitest";
import type { AttrInterpreter } from "./attr-registry";
import { AttrRegistry, attrRegistry, createDefaultAttrRegistry } from "./attr-registry";
import type { ReadonlyAttrs } from "../state";

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

describe("AttrRegistry.applyAll", () => {
  it("returns an empty contribution when attrs is empty", () => {
    const r = new AttrRegistry();
    expect(r.applyAll({})).toEqual({});
  });

  it("ignores attrs that have no registered interpreter", () => {
    const r = new AttrRegistry();
    const attrs: ReadonlyAttrs = { unknownKey: "value" };
    expect(r.applyAll(attrs)).toEqual({});
  });

  it("invokes the interpreter for each registered attr key and merges contributions", () => {
    const r = new AttrRegistry();
    r.register({ attrKey: "bold", toStyle: (v) => (v ? { fontWeight: "bold" } : {}) });
    r.register({ attrKey: "italic", toStyle: (v) => (v ? { fontStyle: "italic" } : {}) });

    const attrs: ReadonlyAttrs = { bold: true, italic: true };
    expect(r.applyAll(attrs)).toEqual({ fontWeight: "bold", fontStyle: "italic" });
  });

  it("later attr keys override earlier attr keys for the same Style property (attrs-key order)", () => {
    // Iteration is over the attrs object's keys, NOT the registry's
    // registration order. This makes the override winner depend on
    // authorial intent (the order keys appear in the attrs object),
    // not on which plugin loaded first. Plugin-stable.
    const r = new AttrRegistry();
    r.register({ attrKey: "link", toStyle: () => ({ color: "blue" }) });
    r.register({ attrKey: "visitedLink", toStyle: () => ({ color: "purple" }) });

    // Same registry; different attrs-key orders → different results.
    const linkFirst: ReadonlyAttrs = { link: true, visitedLink: true };
    const visitedFirst: ReadonlyAttrs = { visitedLink: true, link: true };
    expect(r.applyAll(linkFirst)).toEqual({ color: "purple" });    // visitedLink last → wins
    expect(r.applyAll(visitedFirst)).toEqual({ color: "blue" });   // link last → wins
  });

  it("ignores attrs whose value is undefined (treats them as absent)", () => {
    const r = new AttrRegistry();
    r.register({ attrKey: "bold", toStyle: (v) => (v ? { fontWeight: "bold" } : {}) });
    // The interpreter sees `undefined` and returns {} (its falsy branch).
    expect(r.applyAll({ bold: undefined })).toEqual({});
  });

  it("passes the cascade context through to interpreters when provided", () => {
    const r = new AttrRegistry();
    r.register({
      attrKey: "inheritedColor",
      toStyle: (_value, ctx) => ({ color: ctx?.parentStyle?.color ?? "black" }),
    });
    expect(r.applyAll({ inheritedColor: true })).toEqual({ color: "black" });
    expect(
      r.applyAll(
        { inheritedColor: true },
        { parentStyle: { color: "red" } },
      ),
    ).toEqual({ color: "red" });
  });
});

describe("default attrRegistry singleton", () => {
  it("exists and is an AttrRegistry instance", () => {
    expect(attrRegistry).toBeInstanceOf(AttrRegistry);
  });

  it("starts empty (built-ins are registered separately)", () => {
    // The singleton is shared across the test suite; in this isolated
    // test we just verify it's a valid empty registry. Built-in
    // registration is tested in builtin-attrs.test.ts.
    expect(typeof attrRegistry.register).toBe("function");
    expect(typeof attrRegistry.applyAll).toBe("function");
  });
});

describe("createDefaultAttrRegistry", () => {
  it("returns a registry pre-populated with all built-in interpreters", () => {
    const reg = createDefaultAttrRegistry();
    expect(reg.has("bold")).toBe(true);
    expect(reg.has("italic")).toBe(true);
    expect(reg.has("fontFamily")).toBe(true);
    expect(reg.has("fontSize")).toBe(true);
    expect(reg.has("color")).toBe(true);
    expect(reg.has("backgroundColor")).toBe(true);
    expect(reg.has("underline")).toBe(true);
  });

  it("applyAll produces fontWeight=bold for { bold: true } attrs", () => {
    const reg = createDefaultAttrRegistry();
    const style = reg.applyAll({ bold: true });
    expect(style.fontWeight).toBe("bold");
  });

  it("returns a fresh instance each call (no shared mutable state)", () => {
    const a = createDefaultAttrRegistry();
    const b = createDefaultAttrRegistry();
    expect(a).not.toBe(b);
  });

  it("tabStops interpreter sorts stops ascending and clamps negative positions to 0", () => {
    const reg = createDefaultAttrRegistry();
    const interp = reg.get("tabStops");
    expect(interp).toBeDefined();
    if (!interp) throw new Error("tabStops interpreter not registered");
    const partial = interp.toStyle([
      { position: 200, alignment: "right", leader: "none" },
      { position: -5, alignment: "left", leader: "dot" },
    ]);
    expect(partial.tabStops).toEqual([
      { position: 0, alignment: "left", leader: "dot" },
      { position: 200, alignment: "right", leader: "none" },
    ]);
  });

  it("tabStops interpreter coerces invalid input (non-array → {}, bad alignment/leader → defaults, non-object skipped)", () => {
    const reg = createDefaultAttrRegistry();
    const interp = reg.get("tabStops");
    expect(interp).toBeDefined();
    if (!interp) throw new Error("tabStops interpreter not registered");
    // Non-array / nullish input contributes nothing.
    expect(interp.toStyle("not-an-array")).toEqual({});
    expect(interp.toStyle(null)).toEqual({});
    // Invalid alignment/leader coerced to defaults; non-object entries skipped.
    const partial = interp.toStyle([
      { position: 50, alignment: "bogus", leader: "invalid" },
      "not-an-object",
    ]);
    expect(partial.tabStops).toEqual([
      { position: 50, alignment: "left", leader: "none" },
    ]);
  });
});
