import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { PROPERTY_META } from "../styles";
import { cascadePass, cascadePassIncremental, COMPUTED_STYLE_KEYS } from "./cascade-pass";

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
