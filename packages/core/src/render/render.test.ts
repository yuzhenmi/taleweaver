import { describe, it, expect } from "vitest";
import { render, type RenderOutput } from "./render";
import { createComponentRegistry } from "../components/component-registry";
import { AttrRegistry, createDefaultAttrRegistry } from "../cascade/attr-registry";
import type { AttrInterpreter } from "../cascade/attr-registry";
import type {
  ContainerComponentDefinition,
  LeafComponentDefinition,
} from "../components/component-definition";
import type { RenderNode, ElementBox } from "./render-node";
import { createElementBox } from "./render-node";
import { createEmptyDocument } from "../state/initial-state";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";

const documentComponent: ContainerComponentDefinition = {
  type: "document",
  kind: "container",
  render: (view, _ctx, children) =>
    ({ type: "element", key: view.id, style: { display: "block" }, children } as RenderNode),
};

const paragraphComponent: LeafComponentDefinition = {
  type: "paragraph",
  kind: "leaf",
  leafShape: "inline-bearing",
  render: (view, _ctx, inlineChildren) =>
    ({ type: "element", key: view.id, style: { display: "block" }, children: inlineChildren } as RenderNode),
};

function basicRegistry() {
  const reg = createComponentRegistry();
  reg.register(documentComponent);
  reg.register(paragraphComponent);
  return reg;
}

describe("render (new)", () => {
  it("renders an empty document", () => {
    const state = createEmptyDocument();
    const out: RenderOutput = render(state, basicRegistry(), createDefaultAttrRegistry());
    expect(out.root.type).toBe("element");
    expect((out.root as { children: ReadonlyArray<RenderNode> }).children).toHaveLength(1);
  });

  it("renders a single paragraph with text content", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    expect(out.root.type).toBe("element");
    const docChildren = (out.root as { children: ReadonlyArray<RenderNode> }).children;
    expect(docChildren).toHaveLength(1);
    const p = docChildren[0] as { children: ReadonlyArray<RenderNode> };
    expect(p.children).toHaveLength(1);
    expect((p.children[0] as { text: string }).text).toBe("hello");
  });

  it("renders inline-mixed-attrs into separate TextBoxes", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("hello"),
            text("world", { bold: true }),
          ]),
        }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    const p = ((out.root as { children: ReadonlyArray<RenderNode> }).children[0]) as { children: ReadonlyArray<RenderNode> };
    expect(p.children).toHaveLength(2);
    expect((p.children[0] as { text: string }).text).toBe("hello");
    expect((p.children[1] as { text: string }).text).toBe("world");
  });

  it("throws when an unregistered block type is encountered", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "x", lastChildId: "x" }),
        buildBlock({ id: "x", type: "unknown-block-type", parentId: "doc" }),
      ],
    });
    const reg = createComponentRegistry();
    reg.register(documentComponent);
    expect(() => render(state, reg, createDefaultAttrRegistry())).toThrow(/unknown-block-type/);
  });

  it("renders multi-paragraph document", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("two")]) }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    const docChildren = (out.root as { children: ReadonlyArray<RenderNode> }).children;
    expect(docChildren).toHaveLength(2);
  });

  it("passes computedStyle to components (cascade integration)", () => {
    // Narrowed read-only view of ComputedStyle for the assertion; the
    // production type's `fontWeight: FontWeight` (string | number) needn't
    // leak into the test.
    let observedFontWeight: unknown = undefined;
    let observedSet = false;
    const paragraphCapture: LeafComponentDefinition = {
      type: "paragraph",
      kind: "leaf",
      leafShape: "inline-bearing",
      render: (view, _ctx, _children) => {
        observedFontWeight = view.computedStyle.fontWeight;
        observedSet = true;
        return { type: "element", key: view.id, style: {}, children: [] } as RenderNode;
      },
    };
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          attrs: { bold: true },
          inlineContent: inlineContent([text("x")]),
        }),
      ],
    });
    const reg = createComponentRegistry();
    reg.register(documentComponent);
    reg.register(paragraphCapture);
    render(state, reg, createDefaultAttrRegistry());
    expect(observedSet).toBe(true);
    expect(observedFontWeight).toBe("bold");
  });
});

import type { BlockId } from "../state/block-id";

describe("render — embed-content zones", () => {
  const fnBodyComponent: LeafComponentDefinition = {
    type: "fn-body",
    kind: "leaf",
    leafShape: "inline-bearing",
    render: (view, _ctx, inlineChildren) =>
      ({ type: "element", key: view.id, style: { display: "block" }, children: inlineChildren } as RenderNode),
  };

  it("renders each embed-content block into its own RenderNode keyed by id", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            { kind: "embed", embedType: "fn-anchor", attrs: {}, properties: { contentBlockId: "fn-body-1" } },
          ]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "fn-body-1",
          type: "fn-body",
          inlineContent: inlineContent([text("footnote text")]),
        }),
      ],
    });
    const reg = basicRegistry();
    reg.register(fnBodyComponent);
    const out = render(state, reg, createDefaultAttrRegistry());
    expect(out.embedContents.size).toBe(1);
    const body = out.embedContents.get("fn-body-1" as BlockId);
    expect(body).toBeDefined();
    expect(body?.type).toBe("element");
  });

  it("main-tree walker does NOT recurse into embedContents", () => {
    // The fn-anchor embed in the main doc emits an inline ElementBox, NOT
    // a recursive walk into fn-body. Pagination merges them later.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            { kind: "embed", embedType: "fn-anchor", attrs: {}, properties: { contentBlockId: "fn-body-1" } },
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fn-body-1", type: "fn-body", inlineContent: inlineContent([text("body")]) }),
      ],
    });
    const reg = basicRegistry();
    reg.register(fnBodyComponent);
    const out = render(state, reg, createDefaultAttrRegistry());
    const p = ((out.root as { children: ReadonlyArray<RenderNode> }).children[0]) as { children: ReadonlyArray<RenderNode> };
    // Single inline child: the fn-anchor ElementBox. NOT the fn-body content.
    expect(p.children).toHaveLength(1);
    expect((p.children[0] as { children: ReadonlyArray<RenderNode> }).children).toHaveLength(0);
  });

  it("renders multiple embed-content blocks in parallel", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            { kind: "embed", embedType: "fn-anchor", attrs: {}, properties: { contentBlockId: "fn-1" } },
            { kind: "embed", embedType: "fn-anchor", attrs: {}, properties: { contentBlockId: "fn-2" } },
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fn-1", type: "fn-body", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "fn-2", type: "fn-body", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    const reg = basicRegistry();
    reg.register(fnBodyComponent);
    const out = render(state, reg, createDefaultAttrRegistry());
    expect(out.embedContents.size).toBe(2);
    expect(out.embedContents.has("fn-1" as BlockId)).toBe(true);
    expect(out.embedContents.has("fn-2" as BlockId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R-B fix bundle (A1 + A2 + A3 + A5)
// ---------------------------------------------------------------------------

describe("render — A1: inline RenderNodes carry no pre-cascade computedStyle", () => {
  // A1: cascadePass owns the `computedStyle` field on RenderNodes; the
  // renderer must NOT pre-fill it. Pre-fill creates a new RenderNode identity
  // on every render and is unconditionally overwritten downstream.

  it("TextBoxes produced for inline text items have computedStyle === undefined", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello")]),
        }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    const p = ((out.root as ElementBox).children[0]) as ElementBox;
    const textNode = p.children[0];
    expect(textNode.type).toBe("text");
    expect(textNode.computedStyle).toBeUndefined();
  });

  it("ElementBoxes produced for inline embed items have computedStyle === undefined", () => {
    const fnAnchor: LeafComponentDefinition = {
      type: "fn-body",
      kind: "leaf",
      leafShape: "inline-bearing",
      render: (view, _ctx, inlineChildren) =>
        ({ type: "element", key: view.id, style: { display: "block" }, children: inlineChildren } as RenderNode),
    };
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            { kind: "embed", embedType: "fn-anchor", attrs: {}, properties: { contentBlockId: "fn-1" } },
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fn-1", type: "fn-body", inlineContent: inlineContent([text("body")]) }),
      ],
    });
    const reg = basicRegistry();
    reg.register(fnAnchor);
    const out = render(state, reg, createDefaultAttrRegistry());
    const p = ((out.root as ElementBox).children[0]) as ElementBox;
    const embedNode = p.children[0];
    expect(embedNode.type).toBe("element");
    expect(embedNode.computedStyle).toBeUndefined();
  });

  it("strut sentinel TextBox for empty inline content has computedStyle === undefined", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        // Empty paragraph (no inlineContent items).
        buildBlock({ id: "p", type: "paragraph", parentId: "doc" }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    const p = ((out.root as ElementBox).children[0]) as ElementBox;
    // Strut sentinel must still be emitted (one TextBox child).
    expect(p.children).toHaveLength(1);
    const strut = p.children[0];
    expect(strut.type).toBe("text");
    expect((strut as { text: string }).text).toBe("");
    expect(strut.computedStyle).toBeUndefined();
  });
});

describe("render — A2: visited set is drained per recursion path", () => {
  // A2: cycle detection should mark the active recursion path only, not
  // accumulate over the whole walk. Behavior contract: visited set is empty
  // again at the end of every subtree.

  it("legitimate cycle still throws", () => {
    // A → B → A. Built directly via buildBlock with cross-pointing first/next.
    const state = buildState({
      rootId: "a",
      blocks: [
        buildBlock({ id: "a", type: "document", firstChildId: "b", lastChildId: "b" }),
        // Cycle: b's first child is "a". This is illegal but the renderer
        // must surface it as a cycle, not loop forever.
        buildBlock({ id: "b", type: "document", parentId: "a", firstChildId: "a", lastChildId: "a" }),
      ],
    });
    const reg = createComponentRegistry();
    reg.register(documentComponent);
    expect(() => render(state, reg, createDefaultAttrRegistry())).toThrow(/cycle/);
  });

  it("does NOT false-positive: same block id reused across main-tree and a fresh embed-content walk", () => {
    // Main-tree paragraph and embed-content fn-body share NO id, but the
    // cycle detector's `visited` is freshly seeded for each embed-content
    // walk per `render`. A drained-on-exit visited set is also fine — this
    // test mostly pins the "no false positive" contract on tree topology.
    const fnBody: LeafComponentDefinition = {
      type: "fn-body",
      kind: "leaf",
      leafShape: "inline-bearing",
      render: (view, _ctx, inlineChildren) =>
        ({ type: "element", key: view.id, style: { display: "block" }, children: inlineChildren } as RenderNode),
    };
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("two")]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn", type: "fn-body", inlineContent: inlineContent([text("fn")]) }),
      ],
    });
    const reg = basicRegistry();
    reg.register(fnBody);
    // Renders cleanly — no spurious cycle detection.
    expect(() => render(state, reg, createDefaultAttrRegistry())).not.toThrow();
  });

  it("DAG-diamond (same id reached via two parents in one walk) does NOT throw — the drain is the load-bearing fix", () => {
    // This topology is invalid per state-model invariants (a Block has one
    // parentId, so a tree-shaped state CAN'T legitimately produce a
    // DAG-diamond via firstChildId pointers). But `buildBlock` doesn't
    // enforce that, and the render walker follows firstChildId /
    // nextSiblingId regardless of parentId. Constructing the invalid shape
    // here pins the contract the A2 drain protects: when the same BlockId
    // appears under two disjoint parents in a single walk, the renderer
    // must NOT false-positive on cycle detection.
    //
    // Without the drain (accumulator-style visited set), the second visit
    // to "c" would throw "cycle detected at block c" — falsifying the fix.
    // With the drain (active-path set), the first visit's `finally` block
    // removes "c" before the second visit re-checks `visited.has(c)`.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "a", type: "document", parentId: "doc", nextSiblingId: "b", firstChildId: "c", lastChildId: "c" }),
        buildBlock({ id: "b", type: "document", parentId: "doc", prevSiblingId: "a", firstChildId: "c", lastChildId: "c" }),
        buildBlock({ id: "c", type: "paragraph", parentId: "a", inlineContent: inlineContent([text("shared")]) }),
      ],
    });
    const reg = basicRegistry();
    expect(() => render(state, reg, createDefaultAttrRegistry())).not.toThrow();
  });
});

describe("render — A3: CascadeContext threaded to attrRegistry.applyAll", () => {
  // A3: interpreters that consult ctx.parentStyle must receive it. Pre-fix:
  // applyAll was called with no second arg → interpreters silently degraded
  // to fallback.

  // An interpreter whose output depends on parent style. Reports parent's
  // fontWeight via a marker style; if ctx.parentStyle is absent it emits
  // a different (sentinel) marker.
  const parentSensitiveInterpreter: AttrInterpreter = {
    attrKey: "inheritWeight",
    toStyle: (value, ctx) => {
      if (!value) return {};
      // Read parent's specified fontWeight. If absent, mark with italic
      // (sentinel meaning: "ctx not provided"). If present, mark with bold.
      if (ctx?.parentStyle && ctx.parentStyle.fontWeight !== undefined) {
        return { fontWeight: ctx.parentStyle.fontWeight };
      }
      return { fontStyle: "italic" };
    },
  };

  it("child block sees parent block's specified style via ctx.parentStyle", () => {
    let observedFontWeight: unknown = undefined;
    let observedFontStyle: unknown = undefined;
    const capturingParagraph: LeafComponentDefinition = {
      type: "paragraph",
      kind: "leaf",
      leafShape: "inline-bearing",
      render: (view, _ctx, _children) => {
        observedFontWeight = view.computedStyle.fontWeight;
        observedFontStyle = view.computedStyle.fontStyle;
        return { type: "element", key: view.id, style: {}, children: [] } as RenderNode;
      },
    };
    const state = buildState({
      rootId: "doc",
      blocks: [
        // Parent: bold (so its specified.fontWeight === "bold").
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p", attrs: { bold: true } }),
        // Child: inheritWeight attribute — interpreter consults ctx.parentStyle.
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          attrs: { inheritWeight: true },
          inlineContent: inlineContent([text("x")]),
        }),
      ],
    });
    const reg = createComponentRegistry();
    reg.register(documentComponent);
    reg.register(capturingParagraph);
    const attrReg = new AttrRegistry();
    // Register the built-in `bold` plus the parent-sensitive interpreter.
    const bold: AttrInterpreter = {
      attrKey: "bold",
      toStyle: (v) => (v ? { fontWeight: "bold" } : {}),
    };
    attrReg.register(bold);
    attrReg.register(parentSensitiveInterpreter);
    render(state, reg, attrReg);
    // Post-fix: child paragraph's fontWeight reflects parent context ("bold"),
    // NOT the fallback italic-sentinel.
    expect(observedFontWeight).toBe("bold");
    expect(observedFontStyle).not.toBe("italic");
  });

  it("root block's interpreter receives undefined parentStyle (no parent specified)", () => {
    // The root block has no parent; ctx.parentStyle must be undefined for
    // its interpreter call. The sentinel branch fires.
    let observedFontStyle: unknown = undefined;
    const capturingDoc: ContainerComponentDefinition = {
      type: "document",
      kind: "container",
      render: (view, _ctx, children) => {
        observedFontStyle = view.computedStyle.fontStyle;
        return { type: "element", key: view.id, style: { display: "block" }, children } as RenderNode;
      },
    };
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", attrs: { inheritWeight: true } }),
      ],
    });
    const reg = createComponentRegistry();
    reg.register(capturingDoc);
    const attrReg = new AttrRegistry();
    attrReg.register(parentSensitiveInterpreter);
    render(state, reg, attrReg);
    // Root has no parent specified style → interpreter takes sentinel branch.
    expect(observedFontStyle).toBe("italic");
  });
});

describe("render — A5: atomic-leaf strut sentinel suppression", () => {
  // A5: atomic-leaf components must receive `[]` for inlineRenderNodes,
  // never the strut sentinel — even when inlineContent.items is empty.

  it("atomic leaf with empty inlineContent receives [] (no strut)", () => {
    let observedCount = -1;
    const atomicSpy: LeafComponentDefinition = {
      type: "atomic-spy",
      kind: "leaf",
      leafShape: "atomic",
      render: (view, _ctx, inlineRenderNodes) => {
        observedCount = inlineRenderNodes.length;
        return createElementBox(view.id, { display: "block" }, []);
      },
    };
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "atom", lastChildId: "atom" }),
        // Atomic leaf with NO inlineContent — pre-fix this would receive a strut.
        buildBlock({ id: "atom", type: "atomic-spy", parentId: "doc" }),
      ],
    });
    const reg = createComponentRegistry();
    reg.register(documentComponent);
    reg.register(atomicSpy);
    render(state, reg, createDefaultAttrRegistry());
    expect(observedCount).toBe(0);
  });

  it("inline-bearing leaf with empty inlineContent still receives the strut sentinel", () => {
    let observedCount = -1;
    let observedFirstText: string | null = null;
    const inlineSpy: LeafComponentDefinition = {
      type: "inline-spy",
      kind: "leaf",
      leafShape: "inline-bearing",
      render: (view, _ctx, inlineRenderNodes) => {
        observedCount = inlineRenderNodes.length;
        const first = inlineRenderNodes[0];
        observedFirstText = first?.type === "text" ? first.text : null;
        return createElementBox(view.id, { display: "block" }, [...inlineRenderNodes]);
      },
    };
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "ib", lastChildId: "ib" }),
        buildBlock({ id: "ib", type: "inline-spy", parentId: "doc" }),
      ],
    });
    const reg = createComponentRegistry();
    reg.register(documentComponent);
    reg.register(inlineSpy);
    render(state, reg, createDefaultAttrRegistry());
    expect(observedCount).toBe(1);
    expect(observedFirstText).toBe("");
  });
});
