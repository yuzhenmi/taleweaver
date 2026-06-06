import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import type { ElementBox, RenderNode } from "../render/render-node";
import { PROPERTY_META, INITIAL_COMPUTED_STYLE } from "../styles";
import type { ComputedStyle } from "../styles";
import type { ContentValue } from "../styles/style";
import { cascadePass, cascadePassIncremental, COMPUTED_STYLE_KEYS, computedStylesEqual } from "./cascade-pass";

/** Narrow a cascaded node to ElementBox or throw (test helper). */
function asElement(node: RenderNode): ElementBox {
  if (node.type !== "element") throw new Error("expected element");
  return node;
}

/**
 * The resolved `content` of a cascaded node, flattened to a plain string.
 * After P9a.3 resolution, every `counter()`/`counters()` part is a `string`
 * part, so concatenating the string parts yields the displayed value.
 */
function resolvedContentString(content: ContentValue): string {
  if (typeof content === "string") {
    throw new Error(`expected a ContentPart[] content, got keyword "${content}"`);
  }
  return content
    .map((part) => {
      if (part.kind !== "string") {
        throw new Error(`content part not resolved to a string: kind "${part.kind}"`);
      }
      return part.value;
    })
    .join("");
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

describe("cascadePass — counter resolution (P9a.3, child-bracket walk)", () => {
  it("resolves content:[counter(c)] against the node's own reset+increment", () => {
    // <root counter-reset:c><item counter-increment:c content:[counter(c)]/></root>
    // root resets c→0 (scope), item increments c→1, then content counter(c)→"1".
    const tree = createElementBox("root", { counterReset: [{ name: "c", value: 0 }] }, [
      createElementBox(
        "item",
        {
          counterIncrement: [{ name: "c", value: 1 }],
          content: [{ kind: "counter", name: "c", style: "decimal" }],
        },
        [],
      ),
    ]);

    const cascaded = asElement(cascadePass(tree));
    const item = asElement(cascaded.children[0] as RenderNode);
    expect(item.computedStyle).toBeDefined();
    expect(resolvedContentString(item.computedStyle?.content ?? "normal")).toBe("1");
  });

  it("bare-following-sibling 1,2,3 END-TO-END through cascadePass", () => {
    // The canonical numbered-list pattern (CSS §12.4.1): E1 resets+increments c,
    // E2 and E3 only increment — E1's reset must stay visible to its FOLLOWING
    // siblings, so they read 2 and 3 (NOT each restarting at 1).
    const mk = (key: string, reset: boolean) =>
      createElementBox(
        key,
        {
          ...(reset ? { counterReset: [{ name: "c", value: 0 }] } : {}),
          counterIncrement: [{ name: "c", value: 1 }],
          content: [{ kind: "counter", name: "c", style: "decimal" }],
        },
        [],
      );
    const tree = createElementBox("root", {}, [
      mk("e1", true),
      mk("e2", false),
      mk("e3", false),
    ]);

    const cascaded = asElement(cascadePass(tree));
    const got = cascaded.children.map((c) =>
      resolvedContentString(asElement(c as RenderNode).computedStyle?.content ?? "normal"),
    );
    expect(got).toEqual(["1", "2", "3"]);
  });

  it("two same-depth siblings each reset+increment → each restarts at 1", () => {
    const mk = (key: string) =>
      createElementBox(
        key,
        {
          counterReset: [{ name: "c", value: 0 }],
          counterIncrement: [{ name: "c", value: 1 }],
          content: [{ kind: "counter", name: "c", style: "decimal" }],
        },
        [],
      );
    const tree = createElementBox("root", {}, [mk("a"), mk("b")]);
    const cascaded = asElement(cascadePass(tree));
    const got = cascaded.children.map((c) =>
      resolvedContentString(asElement(c as RenderNode).computedStyle?.content ?? "normal"),
    );
    expect(got).toEqual(["1", "1"]);
  });

  it("nested counters(c, '.') resolves the dotted nested form across sibling resets", () => {
    // The canonical nested-list `counters()` pattern, exercising sibling-reset
    // visibility (CSS §12.4.1): a counter-reset on l2a is visible to its
    // FOLLOWING SIBLING l2b, so the c stack still carries l2a's frame when l2b
    // resets again. With each leaf incrementing the innermost value:
    //   root reset c → [0]
    //   l1   incr  c → [1]                                content "1"
    //   l2a  reset c → [1,0]; i1 incr → [1,1]             content "1.1"
    //     (l2a's child bracket pops i1's pushes; i1 only incremented, so the
    //      shared [.,0] frame is now [.,1] — descendant increments persist)
    //   l2b  reset c → [1,1,0]; i2 incr → [1,1,1]         content "1.1.1"
    // i2 shows depth 3 BECAUSE l2a's reset frame survives into its sibling l2b
    // (sibling-visibility) and i1's increment mutated that shared frame in place.
    const leaf = (key: string) =>
      createElementBox(
        key,
        {
          counterIncrement: [{ name: "c", value: 1 }],
          content: [{ kind: "counters", name: "c", sep: ".", style: "decimal" }],
        },
        [],
      );
    const tree = createElementBox("root", { counterReset: [{ name: "c", value: 0 }] }, [
      createElementBox(
        "l1",
        {
          counterIncrement: [{ name: "c", value: 1 }],
          content: [{ kind: "counters", name: "c", sep: ".", style: "decimal" }],
        },
        [
          createElementBox("l2a", { counterReset: [{ name: "c", value: 0 }] }, [
            leaf("i1"),
          ]),
          createElementBox("l2b", { counterReset: [{ name: "c", value: 0 }] }, [
            leaf("i2"),
          ]),
        ],
      ),
    ]);

    const cascaded = asElement(cascadePass(tree));
    const l1 = asElement(cascaded.children[0] as RenderNode);
    expect(resolvedContentString(l1.computedStyle?.content ?? "normal")).toBe("1");
    const l2a = asElement(l1.children[0] as RenderNode);
    const i1 = asElement(l2a.children[0] as RenderNode);
    expect(resolvedContentString(i1.computedStyle?.content ?? "normal")).toBe("1.1");
    const l2b = asElement(l1.children[1] as RenderNode);
    const i2 = asElement(l2b.children[0] as RenderNode);
    expect(resolvedContentString(i2.computedStyle?.content ?? "normal")).toBe("1.1.1");
  });

  it("nested counters() WITH a containing list element gives the true (1.1, 1.2.1) form", () => {
    // The HTML-list shape where each level's reset lives on a wrapper that
    // contains its items (so sibling items at one level share ONE reset frame).
    //   <root>
    //     <ol1 reset:c>
    //       <li1 incr:c counters>                 → "1"
    //         <ol2 reset:c>
    //           <li2a incr:c counters>            → "1.1"
    //           <li2b incr:c counters>            → "1.2"
    //             <ol3 reset:c>
    //               <li3 incr:c counters>         → "1.2.1"
    const item = (key: string, children: RenderNode[] = []) =>
      createElementBox(
        key,
        {
          counterIncrement: [{ name: "c", value: 1 }],
          content: [{ kind: "counters", name: "c", sep: ".", style: "decimal" }],
        },
        children,
      );
    const ol = (key: string, children: RenderNode[]) =>
      createElementBox(key, { counterReset: [{ name: "c", value: 0 }] }, children);

    const tree = createElementBox("root-wrap", {}, [
      ol("ol1", [
        item("li1", [
          ol("ol2", [
            item("li2a"),
            item("li2b", [ol("ol3", [item("li3")])]),
          ]),
        ]),
      ]),
    ]);

    const cascaded = asElement(cascadePass(tree));
    const ol1 = asElement(cascaded.children[0] as RenderNode);
    const li1 = asElement(ol1.children[0] as RenderNode);
    expect(resolvedContentString(li1.computedStyle?.content ?? "normal")).toBe("1");
    const ol2 = asElement(li1.children[0] as RenderNode);
    const li2a = asElement(ol2.children[0] as RenderNode);
    expect(resolvedContentString(li2a.computedStyle?.content ?? "normal")).toBe("1.1");
    const li2b = asElement(ol2.children[1] as RenderNode);
    expect(resolvedContentString(li2b.computedStyle?.content ?? "normal")).toBe("1.2");
    const ol3 = asElement(li2b.children[0] as RenderNode);
    const li3 = asElement(ol3.children[0] as RenderNode);
    expect(resolvedContentString(li3.computedStyle?.content ?? "normal")).toBe("1.2.1");
  });

  it("keeps verbatim string parts and resolves only counter parts (mixed content)", () => {
    const tree = createElementBox("root", { counterReset: [{ name: "c", value: 0 }] }, [
      createElementBox(
        "item",
        {
          counterIncrement: [{ name: "c", value: 4 }],
          content: [
            { kind: "string", value: "Chapter " },
            { kind: "counter", name: "c", style: "upper-roman" },
            { kind: "string", value: ": " },
          ],
        },
        [],
      ),
    ]);
    const cascaded = asElement(cascadePass(tree));
    const item = asElement(cascaded.children[0] as RenderNode);
    expect(resolvedContentString(item.computedStyle?.content ?? "normal")).toBe("Chapter IV: ");
  });

  it("per-root isolation (M4): two cascadePass calls each start a fresh scope", () => {
    // A body root and a footnote/template body root each cascade via their own
    // cascadePass call. Counters in one must NOT leak into the other.
    const mk = () =>
      createElementBox("root", {}, [
        createElementBox(
          "item",
          {
            counterReset: [{ name: "c", value: 0 }],
            counterIncrement: [{ name: "c", value: 1 }],
            content: [{ kind: "counter", name: "c", style: "decimal" }],
          },
          [],
        ),
      ]);

    const bodyA = asElement(cascadePass(mk()));
    const bodyB = asElement(cascadePass(mk()));
    const itemA = asElement(bodyA.children[0] as RenderNode);
    const itemB = asElement(bodyB.children[0] as RenderNode);
    // Both start fresh → each "1" (B did not continue A's counter to "2").
    expect(resolvedContentString(itemA.computedStyle?.content ?? "normal")).toBe("1");
    expect(resolvedContentString(itemB.computedStyle?.content ?? "normal")).toBe("1");
  });

  it("create-on-use: counter(c) with no prior reset/increment resolves to '0'", () => {
    const tree = createElementBox("root", {}, [
      createElementBox(
        "item",
        { content: [{ kind: "counter", name: "missing", style: "decimal" }] },
        [],
      ),
    ]);
    const cascaded = asElement(cascadePass(tree));
    const item = asElement(cascaded.children[0] as RenderNode);
    expect(resolvedContentString(item.computedStyle?.content ?? "normal")).toBe("0");
  });

  it("no-counter content keyword ('normal'/'none') passes through unchanged", () => {
    const tree = createElementBox("root", {}, [
      createElementBox("normal", {}, []),
      createElementBox("none", { content: "none" }, []),
    ]);
    const cascaded = asElement(cascadePass(tree));
    const n0 = asElement(cascaded.children[0] as RenderNode);
    const n1 = asElement(cascaded.children[1] as RenderNode);
    expect(n0.computedStyle?.content).toBe("normal");
    expect(n1.computedStyle?.content).toBe("none");
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
