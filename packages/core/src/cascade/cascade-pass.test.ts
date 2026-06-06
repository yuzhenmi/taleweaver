import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { PROPERTY_META, INITIAL_COMPUTED_STYLE } from "../styles";
import type { ComputedStyle } from "../styles";
import { cascadePass, cascadePassIncremental, COMPUTED_STYLE_KEYS, computedStylesEqual } from "./cascade-pass";

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
    const p = cascaded.children[0];
    if (p.type !== "element") throw new Error("expected element");
    expect(p.computedStyle?.display).toBe("inline");

    // Text leaf
    const t = p.children[0];
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
    const p = cascaded.children[0];
    if (p.type !== "element") throw new Error("?");
    const t = p.children[0];
    if (t.type !== "text") throw new Error("?");

    expect(t.computedStyle?.color).toBe("red");
    expect(t.computedStyle?.fontSize).toBe(24);
  });

  it("does NOT propagate non-inheritable properties", () => {
    const tree = createElementBox("root", { marginBlockStart: 50 }, [
      createElementBox("p", {}, []),
    ]);

    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    const p = cascaded.children[0];
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
    if (cascadedA.children[0].type !== "element" || cascadedB.children[0].type !== "element") throw new Error("?");
    expect(cascadedA.children[0].computedStyle?.color).toBe("red");
    expect(cascadedB.children[0].computedStyle?.color).toBe("blue");
  });
});

describe("computedStylesEqual — counter / content arrays (P9a, by-value)", () => {
  it("treats two distinct-but-structurally-equal counterReset arrays as equal", () => {
    const a: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      counterReset: [{ name: "c", value: 0 }],
    };
    const b: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      counterReset: [{ name: "c", value: 0 }], // different array instance, same shape
    };
    // The generic `!==`-per-element array branch would WRONGLY report these
    // unequal (object identity). By-value compare must return TRUE.
    expect(computedStylesEqual(a, b)).toBe(true);
  });

  it("returns FALSE when a counterReset value differs", () => {
    const a: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, counterReset: [{ name: "c", value: 0 }] };
    const b: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, counterReset: [{ name: "c", value: 1 }] };
    expect(computedStylesEqual(a, b)).toBe(false);
  });

  it("returns FALSE when a counterReset name differs", () => {
    const a: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, counterReset: [{ name: "c", value: 0 }] };
    const b: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, counterReset: [{ name: "d", value: 0 }] };
    expect(computedStylesEqual(a, b)).toBe(false);
  });

  it("returns FALSE when counterReset lengths differ", () => {
    const a: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, counterReset: [{ name: "c", value: 0 }] };
    const b: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      counterReset: [{ name: "c", value: 0 }, { name: "d", value: 0 }],
    };
    expect(computedStylesEqual(a, b)).toBe(false);
  });

  it("applies the same by-value compare to counterIncrement", () => {
    const a: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, counterIncrement: [{ name: "c", value: 1 }] };
    const b: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, counterIncrement: [{ name: "c", value: 1 }] };
    expect(computedStylesEqual(a, b)).toBe(true);
    const c: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, counterIncrement: [{ name: "c", value: 2 }] };
    expect(computedStylesEqual(a, c)).toBe(false);
  });

  it("treats two distinct-but-structurally-equal content arrays as equal", () => {
    const a: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      content: [{ kind: "counter", name: "c", style: "decimal" }],
    };
    const b: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      content: [{ kind: "counter", name: "c", style: "decimal" }],
    };
    expect(computedStylesEqual(a, b)).toBe(true);
  });

  it("returns FALSE when a content part differs (name / style / kind)", () => {
    const base: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      content: [{ kind: "counter", name: "c", style: "decimal" }],
    };
    const diffName: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      content: [{ kind: "counter", name: "d", style: "decimal" }],
    };
    const diffStyle: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      content: [{ kind: "counter", name: "c", style: "lower-roman" }],
    };
    const diffKind: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      content: [{ kind: "string", value: "c" }],
    };
    expect(computedStylesEqual(base, diffName)).toBe(false);
    expect(computedStylesEqual(base, diffStyle)).toBe(false);
    expect(computedStylesEqual(base, diffKind)).toBe(false);
  });

  it("distinguishes content keyword from a content array", () => {
    const keyword: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, content: "none" };
    const arr: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      content: [{ kind: "string", value: "x" }],
    };
    expect(computedStylesEqual(keyword, arr)).toBe(false);
    // "normal" (initial) vs "none" — two keywords, unequal.
    expect(computedStylesEqual(INITIAL_COMPUTED_STYLE, keyword)).toBe(false);
  });
});

describe("M5 — vocab addition doesn't perturb list cascade", () => {
  it("a numbered-list-item's cascaded computed style is byte-equivalent before/after the vocab keys", () => {
    // A list-item paragraph carrying the same component-emitted props a real
    // numbered list uses. After the P9a vocab addition, its cascaded output for
    // every PRE-EXISTING key must be unchanged, AND the new keys take their
    // constant initials (content "normal", the shared frozen [] for both
    // counter arrays) — i.e. adding the vocab perturbed nothing.
    const tree = createElementBox("list", { display: "block" }, [
      createElementBox(
        "item",
        { display: "list-item", listStyleType: "decimal", listStylePosition: "outside" },
        [createTextBox("t", {}, "first")],
      ),
    ]);

    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    const item = cascaded.children[0];
    if (item.type !== "element") throw new Error("?");
    const cs = item.computedStyle;
    if (cs === undefined) throw new Error("?");

    // Pre-existing list keys cascade exactly as before.
    expect(cs.display).toBe("list-item");
    expect(cs.listStyleType).toBe("decimal");
    expect(cs.listStylePosition).toBe("outside");

    // New keys take their frozen initials (default path, ref-equal to the shared
    // initials so incremental reuse is preserved).
    expect(cs.content).toBe("normal");
    expect(cs.counterReset).toBe(INITIAL_COMPUTED_STYLE.counterReset);
    expect(cs.counterIncrement).toBe(INITIAL_COMPUTED_STYLE.counterIncrement);
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
