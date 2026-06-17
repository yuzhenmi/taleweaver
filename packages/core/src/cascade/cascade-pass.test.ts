import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { PROPERTY_META, INITIAL_COMPUTED_STYLE } from "../styles";
import type { ComputedStyle } from "../styles";
import { cascadePass, cascadePassIncremental, COMPUTED_STYLE_KEYS, computedStylesEqual } from "./cascade-pass";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

describe("cascadePass", () => {
  it("produces a tree where every node carries computedStyle", () => {
    const tree = createElementBox("root", { display: "block" }, [
      createElementBox("p", {}, [
        createTextBox("t", {}, "hello"),
      ]),
    ]);

    const cascaded = cascadePass(tree);

    // Root
    if (cascaded.type !== "element") throw new Error("expected element");
    expect(cascaded.computedStyle).toBeDefined();
    expect(cascaded.computedStyle?.display).toBe("block");

    // Inner element (no display specified → initial 'inline')
    const p = nth(cascaded.children, 0, "p element");
    if (p.type !== "element") throw new Error("expected element");
    expect(p.computedStyle?.display).toBe("inline");

    // Text leaf
    const t = nth(p.children, 0, "t text");
    if (t.type !== "text") throw new Error("expected text");
    expect(t.computedStyle).toBeDefined();
  });

  it("propagates inheritable properties down", () => {
    const tree = createElementBox("root", { color: "red", fontSize: 24 }, [
      createElementBox("p", {}, [
        createTextBox("t", {}, "hello"),
      ]),
    ]);

    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    const p = nth(cascaded.children, 0, "p element");
    if (p.type !== "element") throw new Error("?");
    const t = nth(p.children, 0, "t text");
    if (t.type !== "text") throw new Error("?");

    expect(t.computedStyle?.color).toBe("red");
    expect(t.computedStyle?.fontSize).toBe(24);
  });

  it("inherits `language` from an ancestor; defaults to empty string at the root", () => {
    const tree = createElementBox("root", { language: "en-US" }, [
      createElementBox("p", {}, [
        createTextBox("t", {}, "hello"),
      ]),
    ]);

    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    const p = nth(cascaded.children, 0, "p element");
    if (p.type !== "element") throw new Error("?");
    const t = nth(p.children, 0, "t text");
    if (t.type !== "text") throw new Error("?");

    expect(cascaded.computedStyle?.language).toBe("en-US");
    expect(t.computedStyle?.language).toBe("en-US");

    const noLang = cascadePass(createElementBox("root", { display: "block" }, []));
    expect(noLang.computedStyle?.language).toBe("");
  });

  it("inherits `hyphenateLimitChars` from an ancestor; defaults to [5, 2, 2] at the root", () => {
    const tree = createElementBox("root", { hyphenateLimitChars: [4, 3, 3] }, [
      createElementBox("p", {}, [
        createTextBox("t", {}, "hello"),
      ]),
    ]);

    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    const p = nth(cascaded.children, 0, "p element");
    if (p.type !== "element") throw new Error("?");
    const t = nth(p.children, 0, "t text");
    if (t.type !== "text") throw new Error("?");

    expect(cascaded.computedStyle?.hyphenateLimitChars).toEqual([4, 3, 3]);
    expect(t.computedStyle?.hyphenateLimitChars).toEqual([4, 3, 3]);

    const noLimit = cascadePass(createElementBox("root", { display: "block" }, []));
    expect(noLimit.computedStyle?.hyphenateLimitChars).toEqual([5, 2, 2]);
  });

  it("overflowWrap: defaults to `normal` and inherits (overflow-wrap break-word v1)", () => {
    // Default: a node with no `overflowWrap` gets the CSS initial `normal`.
    const def = cascadePass(createElementBox("root", { display: "block" }, []));
    if (def.type !== "element") throw new Error("?");
    expect(def.computedStyle?.overflowWrap).toBe("normal");
    // Inherits (CSS Text 3 — overflow-wrap is inherited): a text leaf inherits the
    // root's `break-word` through an intervening element with no own value.
    const tree = createElementBox("root", { overflowWrap: "break-word" }, [
      createElementBox("p", {}, [createTextBox("t", {}, "hello")]),
    ]);
    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    const p = nth(cascaded.children, 0, "p element");
    if (p.type !== "element") throw new Error("?");
    const t = nth(p.children, 0, "t text");
    if (t.type !== "text") throw new Error("?");
    expect(t.computedStyle?.overflowWrap).toBe("break-word");
  });

  it("does NOT propagate non-inheritable properties", () => {
    const tree = createElementBox("root", { marginBlockStart: 50 }, [
      createElementBox("p", {}, []),
    ]);

    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    const p = nth(cascaded.children, 0, "p element");
    if (p.type !== "element") throw new Error("?");
    expect(p.computedStyle?.marginBlockStart).toBe(0);  // initial, not inherited
  });

  it("flattens em values using own fontSize", () => {
    const tree = createElementBox("root", {
      fontSize: 20,
      marginBlockStart: { unit: "em", value: 0.5 },
    }, []);

    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    expect(cascaded.computedStyle?.marginBlockStart).toBe(10);  // 20 * 0.5
  });
});

describe("cascadePassIncremental", () => {
  it("reuses computed style for unchanged subtrees (reference-equal)", () => {
    const subtree = createElementBox("inner", { display: "block" }, [
      createTextBox("t", {}, "x"),
    ]);
    const treeA = createElementBox("root", { display: "block" }, [subtree]);
    const treeB = createElementBox("root", { display: "block" }, [subtree]); // same subtree ref

    const cascadedA = cascadePass(treeA);
    const cascadedB = cascadePassIncremental(treeB, treeA, cascadedA);

    if (cascadedA.type !== "element" || cascadedB.type !== "element") throw new Error("?");
    expect(cascadedB.children[0]).toBe(cascadedA.children[0]);
  });

  it("recomputes when an inheritable property changes on parent", () => {
    const child = createElementBox("c", {}, []);
    const treeA = createElementBox("root", { color: "red" }, [child]);
    const treeB = createElementBox("root", { color: "blue" }, [child]);  // same child ref

    const cascadedA = cascadePass(treeA);
    const cascadedB = cascadePassIncremental(treeB, treeA, cascadedA);

    if (cascadedA.type !== "element" || cascadedB.type !== "element") throw new Error("?");
    const childA = nth(cascadedA.children, 0, "child A");
    const childB = nth(cascadedB.children, 0, "child B");
    if (childA.type !== "element" || childB.type !== "element") throw new Error("?");
    expect(childA.computedStyle?.color).toBe("red");
    expect(childB.computedStyle?.color).toBe("blue");
  });
});

describe("computedStylesEqual structural comparison", () => {
  // Regression: the equality walk must compare nested object/array values
  // (TransformOrigin {x,y}, transform: TransformFn[], listStyleType {content})
  // by VALUE, not reference. A reference-distinct-but-equal value returning
  // `false` causes a spurious re-cascade/re-layout in the incremental path.
  it("treats reference-distinct but structurally-equal transformOrigin as equal", () => {
    const a: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, transformOrigin: { x: { unit: "percent", value: 25 }, y: { unit: "percent", value: 75 } } };
    const b: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, transformOrigin: { x: { unit: "percent", value: 25 }, y: { unit: "percent", value: 75 } } };
    expect(computedStylesEqual(a, b)).toBe(true);
  });

  it("treats differing transformOrigin as unequal", () => {
    const a: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, transformOrigin: { x: { unit: "percent", value: 25 }, y: { unit: "percent", value: 75 } } };
    const b: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, transformOrigin: { x: { unit: "percent", value: 50 }, y: { unit: "percent", value: 75 } } };
    expect(computedStylesEqual(a, b)).toBe(false);
  });

  it("treats reference-distinct but structurally-equal transform arrays as equal", () => {
    const a: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, transform: [{ fn: "rotate", angleRad: 1.5 }, { fn: "scale", sx: 2, sy: 3 }] };
    const b: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, transform: [{ fn: "rotate", angleRad: 1.5 }, { fn: "scale", sx: 2, sy: 3 }] };
    expect(computedStylesEqual(a, b)).toBe(true);
  });

  it("treats transform arrays differing in a struct field or length as unequal", () => {
    const a: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, transform: [{ fn: "rotate", angleRad: 1.5 }] };
    const b: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, transform: [{ fn: "rotate", angleRad: 2.0 }] };
    const c: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, transform: [{ fn: "rotate", angleRad: 1.5 }, { fn: "scale", sx: 1, sy: 1 }] };
    expect(computedStylesEqual(a, b)).toBe(false);
    expect(computedStylesEqual(a, c)).toBe(false);
  });

  it("the default shared-frozen transform/transformOrigin compare equal (reference + structural)", () => {
    const a: ComputedStyle = { ...INITIAL_COMPUTED_STYLE };
    const b: ComputedStyle = { ...INITIAL_COMPUTED_STYLE };
    expect(computedStylesEqual(a, b)).toBe(true);
  });
});

describe("COMPUTED_STYLE_KEYS", () => {
  it("matches the PROPERTY_META key set (drift insurance)", () => {
    // If a new Style/ComputedStyle property is added to PROPERTY_META but
    // COMPUTED_STYLE_KEYS isn't derived from it, computedStylesEqual will
    // silently skip the new key — which would let incremental layout reuse
    // stale boxes after a style change. Derive-from-source guarantees parity.
    expect(COMPUTED_STYLE_KEYS.length).toBe(Object.keys(PROPERTY_META).length);
    const set = new Set(COMPUTED_STYLE_KEYS);
    for (const k of Object.keys(PROPERTY_META)) {
      expect(set.has(k as keyof typeof PROPERTY_META)).toBe(true);
    }
  });
});
