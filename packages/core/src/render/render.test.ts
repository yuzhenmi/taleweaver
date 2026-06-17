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
import { createEmptyDocument } from "../state";
import type { BlockId } from "../state";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
// C.2a-T5: template-content zones (parallel to embed-content zones).
// Header/footer template bodies live in the templateContents Y.Map and
// render into RenderOutput.templateContents the same way footnote bodies
// render into RenderOutput.embedContents. Inert in C.2a — nothing positions
// these bodies until C.2c.
// ---------------------------------------------------------------------------

describe("render — template-content zones", () => {
  const tmplBodyComponent: LeafComponentDefinition = {
    type: "tmpl-body",
    kind: "leaf",
    leafShape: "inline-bearing",
    render: (view, _ctx, inlineChildren) =>
      ({ type: "element", key: view.id, style: { display: "block" }, children: inlineChildren } as RenderNode),
  };

  it("renders each template-content block into its own RenderNode keyed by id", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("body text")]),
        }),
      ],
      templateContents: [
        buildBlock({
          id: "hdr-body-1",
          type: "tmpl-body",
          inlineContent: inlineContent([text("header text")]),
        }),
      ],
    });
    const reg = basicRegistry();
    reg.register(tmplBodyComponent);
    const out = render(state, reg, createDefaultAttrRegistry());
    expect(out.templateContents.size).toBe(1);
    const body = out.templateContents.get("hdr-body-1" as BlockId);
    expect(body).toBeDefined();
    expect(body?.type).toBe("element");
    expect(body?.key).toBe("hdr-body-1");
  });

  it("empty case: no template bodies → templateContents.size === 0, root + embedContents unchanged", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    expect(out.templateContents.size).toBe(0);
    // No regression to the existing maps: root still a document element with
    // one child, embedContents still empty.
    expect(out.root.type).toBe("element");
    expect((out.root as ElementBox).children).toHaveLength(1);
    expect(out.embedContents.size).toBe(0);
  });

  it("incremental render: dirty template body re-rendered fresh, unchanged body reused by ref", () => {
    const reg = basicRegistry();
    reg.register(tmplBodyComponent);
    const attrs = createDefaultAttrRegistry();

    const state1 = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("doc body")]) }),
      ],
      templateContents: [
        buildBlock({ id: "hdr-a", type: "tmpl-body", inlineContent: inlineContent([text("alpha")]) }),
        buildBlock({ id: "hdr-b", type: "tmpl-body", inlineContent: inlineContent([text("beta")]) }),
      ],
    });
    const prev = render(state1, reg, attrs);

    // New state: hdr-a's content changed, hdr-b unchanged. The
    // incremental render is driven by an explicit dirtyIds set naming the
    // changed body (template bodies have no main-tree parent chain, so the
    // invalidation set is exactly {hdr-a}). hdr-b must be reused by ref.
    const state2 = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("doc body")]) }),
      ],
      templateContents: [
        buildBlock({ id: "hdr-a", type: "tmpl-body", inlineContent: inlineContent([text("ALPHA-edited")]) }),
        buildBlock({ id: "hdr-b", type: "tmpl-body", inlineContent: inlineContent([text("beta")]) }),
      ],
    });

    const out = render(state2, reg, attrs, {
      prev,
      prevState: state1,
      dirtyIds: new Set(["hdr-a" as BlockId]),
    });

    const prevA = prev.templateContents.get("hdr-a" as BlockId);
    const outA = out.templateContents.get("hdr-a" as BlockId);
    const prevB = prev.templateContents.get("hdr-b" as BlockId);
    const outB = out.templateContents.get("hdr-b" as BlockId);

    // hdr-b unchanged → reused by reference from prev.
    expect(outB).toBe(prevB);
    // hdr-a dirty → freshly produced (different reference).
    expect(outA).not.toBe(prevA);
    // …and the fresh node reflects the edited content.
    expect(outA?.type).toBe("element");
    if (outA?.type === "element") {
      const textChild = nth(outA.children, 0, "text child");
      expect(textChild.type).toBe("text");
      expect((textChild as { text: string }).text).toBe("ALPHA-edited");
    }
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
    const textNode = nth(p.children, 0, "text node");
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
    const embedNode = nth(p.children, 0, "embed node");
    expect(embedNode.type).toBe("element");
    expect(embedNode.computedStyle).toBeUndefined();
    // E-E.1 follow-up: embed elements render as `display: inline-block`
    // with explicit `inlineSize: 0` so the IFC emits exactly one atomic
    // token contributing 1 to the per-line state-model offset cursor
    // (matching the state-model rule that each embed counts as one
    // cursor position). Without this, an empty embed produces no IFC
    // tokens and the offset accumulator drifts from state by 1 per
    // embed.
    if (embedNode.type !== "element") throw new Error("expected element");
    expect(embedNode.style.display).toBe("inline-block");
    expect(embedNode.style.inlineSize).toBe(0);
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
    const strut = nth(p.children, 0, "strut sentinel");
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

describe("render (incremental — R-D)", () => {
  function threeParagraphState() {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("first")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("second")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("third")]) }),
      ],
    });
  }

  it("empty dirtyIds returns prev as-is (top-level reference equality)", () => {
    const state = threeParagraphState();
    const reg = basicRegistry();
    const attrs = createDefaultAttrRegistry();
    const prev = render(state, reg, attrs);
    const out = render(state, reg, attrs, {
      prev,
      prevState: state,
      dirtyIds: new Set(),
    });
    expect(out).toBe(prev);
  });

  it("incremental render: unchanged sibling subtrees keep reference equality", async () => {
    const reg = basicRegistry();
    const attrs = createDefaultAttrRegistry();
    const state1 = threeParagraphState();
    const prev = render(state1, reg, attrs);

    // Mutate only p2 via a state-module operation. Use insertText
    // (Layer 3) so we get a real dirtyIds set.
    const { insertText } = await import("../state/ops/insert-text");
    const { createPosition } = await import("../state/block-position");
    const { productionAllocator: _alloc } = await import("../state/block-id");
    const r = insertText(state1, createPosition("p2" as BlockId, 0), "X", {});

    const out = render(r.state, reg, attrs, {
      prev,
      prevState: state1,
      dirtyIds: r.dirtyIds,
    });

    // Find p1, p2, p3 in both outputs.
    function findChild(root: RenderNode, key: string): RenderNode | undefined {
      if (root.type !== "element") return undefined;
      for (const c of (root as ElementBox).children) {
        if (c.key === key) return c;
        if (c.type === "element") {
          const found = findChild(c, key);
          if (found !== undefined) return found;
        }
      }
      return undefined;
    }
    const prevP1 = findChild(prev.root, "p1");
    const outP1 = findChild(out.root, "p1");
    const prevP3 = findChild(prev.root, "p3");
    const outP3 = findChild(out.root, "p3");
    const prevP2 = findChild(prev.root, "p2");
    const outP2 = findChild(out.root, "p2");

    // p1 and p3 unchanged — reference-equal in both outputs.
    expect(outP1).toBe(prevP1);
    expect(outP3).toBe(prevP3);
    // p2 was mutated — NEW RenderNode (different reference).
    expect(outP2).not.toBe(prevP2);
    // Root is an ancestor of a dirty child — also new RenderNode.
    expect(out.root).not.toBe(prev.root);
  });

  it("incremental render drift: incremental output equals full rebuild structurally", async () => {
    const reg = basicRegistry();
    const attrs = createDefaultAttrRegistry();
    const state1 = threeParagraphState();
    const prev = render(state1, reg, attrs);

    const { insertText } = await import("../state/ops/insert-text");
    const { createPosition } = await import("../state/block-position");
    const r = insertText(state1, createPosition("p2" as BlockId, 0), "X", {});

    const incremental = render(r.state, reg, attrs, {
      prev,
      prevState: state1,
      dirtyIds: r.dirtyIds,
    });
    const fullRebuild = render(r.state, reg, attrs);

    // Structural equality of the trees (key + type + children counts +
    // text contents). Reference identities will differ because
    // fullRebuild creates everything fresh.
    function shape(n: RenderNode): unknown {
      if (n.type === "text") return { type: "text", key: n.key, text: n.text };
      return {
        type: "element",
        key: n.key,
        children: (n as ElementBox).children.map(shape),
      };
    }
    expect(shape(incremental.root)).toEqual(shape(fullRebuild.root));
  });

  it("incremental render without options falls through to full rebuild (existing callers unaffected)", () => {
    const state = threeParagraphState();
    const reg = basicRegistry();
    const attrs = createDefaultAttrRegistry();
    const out1 = render(state, reg, attrs);
    const out2 = render(state, reg, attrs);
    // No prev/prevState/dirtyIds → both calls do full rebuild → trees
    // are structurally equal but NOT reference-equal at the root.
    expect(out2).not.toBe(out1);
    expect(out2.root).not.toBe(out1.root);
  });

  // S-B3 regression guard: removeBlock no longer dirties the parent on a
  // MIDDLE removal (it only writes a parent boundary pointer when that
  // boundary actually changes). This test proves the parent STILL re-renders
  // via render's computeInvalidatedBlocks ancestor-walk — the deleted child is
  // in dirtyIds, the walk resolves it through prevState, and its parent gets
  // added to the invalidation set — EVEN THOUGH the parent id is NOT in
  // dirtyIds. This is the safety net for the dirtyIds-contract change.
  it("middle removeBlock re-renders the parent via ancestor-walk even though parent ∉ dirtyIds", async () => {
    const reg = basicRegistry();
    const attrs = createDefaultAttrRegistry();
    const state1 = threeParagraphState();
    const prev = render(state1, reg, attrs);

    const { removeBlock } = await import("../state/ops/remove-block");
    // Remove the MIDDLE child p2.
    const { state: state2, dirtyIds } = removeBlock(state1, "p2" as BlockId);

    // Make the point explicit: the parent (doc) is NOT in dirtyIds for a
    // middle removal under the new contract.
    expect(dirtyIds.has("doc" as BlockId)).toBe(false);
    // The deleted child IS in dirtyIds (part of the deleted subtree).
    expect(dirtyIds.has("p2" as BlockId)).toBe(true);

    const out = render(state2, reg, attrs, {
      prev,
      prevState: state1,
      dirtyIds,
    });

    function findChild(root: RenderNode, key: string): RenderNode | undefined {
      if (root.type !== "element") return undefined;
      for (const c of (root as ElementBox).children) {
        if (c.key === key) return c;
        if (c.type === "element") {
          const found = findChild(c, key);
          if (found !== undefined) return found;
        }
      }
      return undefined;
    }

    // out.root / prev.root ARE the parent (the "doc" container) RenderNode.
    const prevDoc = prev.root;
    const outDoc = out.root;
    expect(prevDoc.key).toBe("doc");
    expect(outDoc.key).toBe("doc");
    // The parent's RenderNode was REBUILT — different object identity than
    // prev's parent node — despite parent ∉ dirtyIds.
    expect(outDoc).not.toBe(prevDoc);

    // The rebuilt parent's children no longer include a node for the removed
    // child b (p2); a (p1) and c (p3) remain.
    expect(findChild(out.root, "p1")).toBeDefined();
    expect(findChild(out.root, "p3")).toBeDefined();
    expect(findChild(out.root, "p2")).toBeUndefined();

    // And p1 / p3 (untouched siblings beyond the rewired link) are still
    // present as the parent's direct children.
    const outDocChildren = (outDoc as ElementBox).children;
    expect(outDocChildren.map((c) => c.key).sort()).toEqual(["p1", "p3"]);
  });
});

// ---------------------------------------------------------------------------
// #285 / closes #221: multi-level container bodies in embedContents /
// templateContents. The render module walks the block tree by id
// (parentId / firstChildId / nextSiblingId). Pre-fix it used
// `getBlock(state, id)` everywhere, which reads ONLY the main `blocks`
// Y.Map. Blocks nested INSIDE an embed/template container body live in the
// embedContents/templateContents Y.Map, so every such walk returned null:
//   - the invalidation ancestor walk broke immediately → the body root was
//     never invalidated → the stale body was reused (edit silently
//     swallowed);
//   - and even once the body root IS invalidated, the body RE-RENDER's
//     child iteration would throw "child not found" for the body's
//     children.
// The fix swaps every tree-walk site to `resolveBlock(state, id)?.block`
// (resolveBlock's first arm is getBlock, so main-tree behavior is
// byte-identical). These tests exercise MULTI-LEVEL bodies: the body root
// is a `kind: "container"` component and its child blocks are registered
// in the same content array (they live in the content Y.Map).
// ---------------------------------------------------------------------------

describe("render — #285 multi-level embed/template container bodies", () => {
  // A container body root: dispatches its pre-rendered children.
  const bodyContainerComponent: ContainerComponentDefinition = {
    type: "body-container",
    kind: "container",
    render: (view, _ctx, children) =>
      ({ type: "element", key: view.id, style: { display: "block" }, children } as RenderNode),
  };
  // A leaf paragraph used inside the body.
  const bodyParaComponent: LeafComponentDefinition = {
    type: "body-para",
    kind: "leaf",
    leafShape: "inline-bearing",
    render: (view, _ctx, inlineChildren) =>
      ({ type: "element", key: view.id, style: { display: "block" }, children: inlineChildren } as RenderNode),
  };

  function bodyRegistry() {
    const reg = basicRegistry();
    reg.register(bodyContainerComponent);
    reg.register(bodyParaComponent);
    return reg;
  }

  // Walk a RenderNode tree to find an element/text node by key.
  function findByKey(node: RenderNode, key: string): RenderNode | undefined {
    if (node.key === key) return node;
    if (node.type === "element") {
      for (const child of (node as ElementBox).children) {
        const found = findByKey(child, key);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  // Read the text content of the first text descendant of a leaf-block
  // RenderNode (the body paragraph wraps its text in inline children).
  function firstText(node: RenderNode | undefined): string | undefined {
    if (node === undefined) return undefined;
    if (node.type === "text") return node.text;
    if (node.type === "element") {
      for (const child of (node as ElementBox).children) {
        const t = firstText(child);
        if (t !== undefined) return t;
      }
    }
    return undefined;
  }

  function mainDoc() {
    return [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("doc body")]) }),
    ];
  }

  // ── Multi-level TEMPLATE body, dirty CHILD (the core bug) ───────────────
  it("incremental: dirty child inside a multi-level TEMPLATE container body re-renders (edit not swallowed)", () => {
    const reg = bodyRegistry();
    const attrs = createDefaultAttrRegistry();

    // tpl-body is a CONTAINER root with children tpl-p1 / tpl-p2. All three
    // registered in templateContents → they live in the templateContents
    // Y.Map, NOT the main blocks map.
    const state1 = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      templateContents: [
        buildBlock({ id: "tpl-body", type: "body-container", firstChildId: "tpl-p1", lastChildId: "tpl-p2" }),
        buildBlock({ id: "tpl-p1", type: "body-para", parentId: "tpl-body", nextSiblingId: "tpl-p2", inlineContent: inlineContent([text("p1 original")]) }),
        buildBlock({ id: "tpl-p2", type: "body-para", parentId: "tpl-body", prevSiblingId: "tpl-p1", inlineContent: inlineContent([text("p2 original")]) }),
      ],
    });
    const prev = render(state1, reg, attrs);

    // New state: tpl-p1's text edited. dirtyIds names only the changed child
    // (the state op produces the changed leaf id). The invalidation walk
    // must climb tpl-p1 → tpl-body (through the template tree) so the body
    // root re-renders.
    const state2 = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      templateContents: [
        buildBlock({ id: "tpl-body", type: "body-container", firstChildId: "tpl-p1", lastChildId: "tpl-p2" }),
        buildBlock({ id: "tpl-p1", type: "body-para", parentId: "tpl-body", nextSiblingId: "tpl-p2", inlineContent: inlineContent([text("p1 EDITED")]) }),
        buildBlock({ id: "tpl-p2", type: "body-para", parentId: "tpl-body", prevSiblingId: "tpl-p1", inlineContent: inlineContent([text("p2 original")]) }),
      ],
    });

    const out = render(state2, reg, attrs, {
      prev,
      prevState: state1,
      dirtyIds: new Set(["tpl-p1" as BlockId]),
    });

    const body = out.templateContents.get("tpl-body" as BlockId);
    expect(body).toBeDefined();
    // The re-rendered body must reflect the NEW tpl-p1 text. PRE-FIX this is
    // "p1 original" (stale body reused wholesale) — edit silently swallowed.
    const p1Node = body !== undefined ? findByKey(body, "tpl-p1") : undefined;
    expect(firstText(p1Node)).toBe("p1 EDITED");
    // tpl-p2 unchanged content still present.
    const p2Node = body !== undefined ? findByKey(body, "tpl-p2") : undefined;
    expect(firstText(p2Node)).toBe("p2 original");
  });

  // ── Multi-level EMBED body, dirty CHILD ─────────────────────────────────
  it("incremental: dirty child inside a multi-level EMBED container body re-renders (edit not swallowed)", () => {
    const reg = bodyRegistry();
    const attrs = createDefaultAttrRegistry();

    const state1 = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      embedContents: [
        buildBlock({ id: "emb-body", type: "body-container", firstChildId: "emb-p1", lastChildId: "emb-p2" }),
        buildBlock({ id: "emb-p1", type: "body-para", parentId: "emb-body", nextSiblingId: "emb-p2", inlineContent: inlineContent([text("e1 original")]) }),
        buildBlock({ id: "emb-p2", type: "body-para", parentId: "emb-body", prevSiblingId: "emb-p1", inlineContent: inlineContent([text("e2 original")]) }),
      ],
    });
    const prev = render(state1, reg, attrs);

    const state2 = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      embedContents: [
        buildBlock({ id: "emb-body", type: "body-container", firstChildId: "emb-p1", lastChildId: "emb-p2" }),
        buildBlock({ id: "emb-p1", type: "body-para", parentId: "emb-body", nextSiblingId: "emb-p2", inlineContent: inlineContent([text("e1 EDITED")]) }),
        buildBlock({ id: "emb-p2", type: "body-para", parentId: "emb-body", prevSiblingId: "emb-p1", inlineContent: inlineContent([text("e2 original")]) }),
      ],
    });

    const out = render(state2, reg, attrs, {
      prev,
      prevState: state1,
      dirtyIds: new Set(["emb-p1" as BlockId]),
    });

    const body = out.embedContents.get("emb-body" as BlockId);
    expect(body).toBeDefined();
    const p1Node = body !== undefined ? findByKey(body, "emb-p1") : undefined;
    expect(firstText(p1Node)).toBe("e1 EDITED");
    const p2Node = body !== undefined ? findByKey(body, "emb-p2") : undefined;
    expect(firstText(p2Node)).toBe("e2 original");
  });

  // ── FULL-RENDER multi-level body (pins the renderBlock full-path sites) ──
  it("full render: multi-level TEMPLATE container body produces both children correctly", () => {
    const reg = bodyRegistry();
    const state = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      templateContents: [
        buildBlock({ id: "tpl-body", type: "body-container", firstChildId: "tpl-p1", lastChildId: "tpl-p2" }),
        buildBlock({ id: "tpl-p1", type: "body-para", parentId: "tpl-body", nextSiblingId: "tpl-p2", inlineContent: inlineContent([text("alpha")]) }),
        buildBlock({ id: "tpl-p2", type: "body-para", parentId: "tpl-body", prevSiblingId: "tpl-p1", inlineContent: inlineContent([text("beta")]) }),
      ],
    });
    // PRE-FIX: renderBlock's container child-iteration calls getBlock(state,
    // "tpl-p1") → null (child lives in templateContents) → throws
    // "child ... not found". Post-fix the body renders with both children.
    const out = render(state, reg, createDefaultAttrRegistry());
    const body = out.templateContents.get("tpl-body" as BlockId);
    expect(body).toBeDefined();
    if (body === undefined || body.type !== "element") throw new Error("expected body element");
    expect((body as ElementBox).children).toHaveLength(2);
    expect(firstText(findByKey(body, "tpl-p1"))).toBe("alpha");
    expect(firstText(findByKey(body, "tpl-p2"))).toBe("beta");
  });

  it("full render: multi-level EMBED container body produces both children correctly", () => {
    const reg = bodyRegistry();
    const state = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      embedContents: [
        buildBlock({ id: "emb-body", type: "body-container", firstChildId: "emb-p1", lastChildId: "emb-p2" }),
        buildBlock({ id: "emb-p1", type: "body-para", parentId: "emb-body", nextSiblingId: "emb-p2", inlineContent: inlineContent([text("alpha")]) }),
        buildBlock({ id: "emb-p2", type: "body-para", parentId: "emb-body", prevSiblingId: "emb-p1", inlineContent: inlineContent([text("beta")]) }),
      ],
    });
    const out = render(state, reg, createDefaultAttrRegistry());
    const body = out.embedContents.get("emb-body" as BlockId);
    expect(body).toBeDefined();
    if (body === undefined || body.type !== "element") throw new Error("expected body element");
    expect((body as ElementBox).children).toHaveLength(2);
    expect(firstText(findByKey(body, "emb-p1"))).toBe("alpha");
    expect(firstText(findByKey(body, "emb-p2"))).toBe("beta");
  });

  // ── Unchanged OTHER body reused by ref ──────────────────────────────────
  it("incremental: a multi-level body not in dirtyIds is reused by reference", () => {
    const reg = bodyRegistry();
    const attrs = createDefaultAttrRegistry();

    // Two multi-level template bodies; only the first's child is dirty.
    const bodies1 = [
      buildBlock({ id: "tpl-a", type: "body-container", firstChildId: "a-p1", lastChildId: "a-p1" }),
      buildBlock({ id: "a-p1", type: "body-para", parentId: "tpl-a", inlineContent: inlineContent([text("a original")]) }),
      buildBlock({ id: "tpl-b", type: "body-container", firstChildId: "b-p1", lastChildId: "b-p1" }),
      buildBlock({ id: "b-p1", type: "body-para", parentId: "tpl-b", inlineContent: inlineContent([text("b stable")]) }),
    ];
    const state1 = buildState({ rootId: "doc", blocks: mainDoc(), templateContents: bodies1 });
    const prev = render(state1, reg, attrs);

    const bodies2 = [
      buildBlock({ id: "tpl-a", type: "body-container", firstChildId: "a-p1", lastChildId: "a-p1" }),
      buildBlock({ id: "a-p1", type: "body-para", parentId: "tpl-a", inlineContent: inlineContent([text("a EDITED")]) }),
      buildBlock({ id: "tpl-b", type: "body-container", firstChildId: "b-p1", lastChildId: "b-p1" }),
      buildBlock({ id: "b-p1", type: "body-para", parentId: "tpl-b", inlineContent: inlineContent([text("b stable")]) }),
    ];
    const state2 = buildState({ rootId: "doc", blocks: mainDoc(), templateContents: bodies2 });

    const out = render(state2, reg, attrs, {
      prev,
      prevState: state1,
      dirtyIds: new Set(["a-p1" as BlockId]),
    });

    // tpl-b not in the invalidation set → reused by reference from prev.
    expect(out.templateContents.get("tpl-b" as BlockId)).toBe(prev.templateContents.get("tpl-b" as BlockId));
    // tpl-a was invalidated (its child changed) → fresh node.
    expect(out.templateContents.get("tpl-a" as BlockId)).not.toBe(prev.templateContents.get("tpl-a" as BlockId));
  });

  // ── #221 grandchild ancestor reach ──────────────────────────────────────
  it("incremental: dirty GRANDCHILD inside a nested container body propagates to the body root (#221)", () => {
    const reg = bodyRegistry();
    const attrs = createDefaultAttrRegistry();

    // root container → child container → grandchild paragraph, all in
    // templateContents.
    const bodies1 = [
      buildBlock({ id: "g-root", type: "body-container", firstChildId: "g-mid", lastChildId: "g-mid" }),
      buildBlock({ id: "g-mid", type: "body-container", parentId: "g-root", firstChildId: "g-leaf", lastChildId: "g-leaf" }),
      buildBlock({ id: "g-leaf", type: "body-para", parentId: "g-mid", inlineContent: inlineContent([text("grand original")]) }),
    ];
    const state1 = buildState({ rootId: "doc", blocks: mainDoc(), templateContents: bodies1 });
    const prev = render(state1, reg, attrs);

    const bodies2 = [
      buildBlock({ id: "g-root", type: "body-container", firstChildId: "g-mid", lastChildId: "g-mid" }),
      buildBlock({ id: "g-mid", type: "body-container", parentId: "g-root", firstChildId: "g-leaf", lastChildId: "g-leaf" }),
      buildBlock({ id: "g-leaf", type: "body-para", parentId: "g-mid", inlineContent: inlineContent([text("grand EDITED")]) }),
    ];
    const state2 = buildState({ rootId: "doc", blocks: mainDoc(), templateContents: bodies2 });

    const out = render(state2, reg, attrs, {
      prev,
      prevState: state1,
      // Only the grandchild is named dirty; the ancestor walk must climb
      // g-leaf → g-mid → g-root through the template tree.
      dirtyIds: new Set(["g-leaf" as BlockId]),
    });

    const body = out.templateContents.get("g-root" as BlockId);
    expect(body).toBeDefined();
    const leafNode = body !== undefined ? findByKey(body, "g-leaf") : undefined;
    expect(firstText(leafNode)).toBe("grand EDITED");
  });

  // ── Gap B (efficiency): fine-grained sibling reuse WITHIN a re-rendered body ─
  // When a dirty body is re-rendered via renderBlockIncremental, its unchanged
  // siblings must be looked up in prevByKey and reused by reference. Pre-T2
  // prevByKey was built only from prev.root, so body-internal nodes were never
  // indexed → every unchanged sibling was rebuilt fresh (not O(1) per keystroke,
  // the C.2c requirement).
  it("incremental: unchanged sibling inside a dirty TEMPLATE body is reused by reference (fine-grained)", () => {
    const reg = bodyRegistry();
    const attrs = createDefaultAttrRegistry();

    const state1 = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      templateContents: [
        buildBlock({ id: "tpl-body", type: "body-container", firstChildId: "tpl-p1", lastChildId: "tpl-p2" }),
        buildBlock({ id: "tpl-p1", type: "body-para", parentId: "tpl-body", nextSiblingId: "tpl-p2", inlineContent: inlineContent([text("p1 original")]) }),
        buildBlock({ id: "tpl-p2", type: "body-para", parentId: "tpl-body", prevSiblingId: "tpl-p1", inlineContent: inlineContent([text("p2 original")]) }),
      ],
    });
    const prev = render(state1, reg, attrs);

    // Only tpl-p1 changes; tpl-p2 is untouched.
    const state2 = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      templateContents: [
        buildBlock({ id: "tpl-body", type: "body-container", firstChildId: "tpl-p1", lastChildId: "tpl-p2" }),
        buildBlock({ id: "tpl-p1", type: "body-para", parentId: "tpl-body", nextSiblingId: "tpl-p2", inlineContent: inlineContent([text("p1 EDITED")]) }),
        buildBlock({ id: "tpl-p2", type: "body-para", parentId: "tpl-body", prevSiblingId: "tpl-p1", inlineContent: inlineContent([text("p2 original")]) }),
      ],
    });

    const out = render(state2, reg, attrs, {
      prev,
      prevState: state1,
      dirtyIds: new Set(["tpl-p1" as BlockId]),
    });

    const prevBody = prev.templateContents.get("tpl-body" as BlockId);
    const outBody = out.templateContents.get("tpl-body" as BlockId);
    expect(prevBody).toBeDefined();
    expect(outBody).toBeDefined();
    const prevP2 = prevBody !== undefined ? findByKey(prevBody, "tpl-p2") : undefined;
    const outP2 = outBody !== undefined ? findByKey(outBody, "tpl-p2") : undefined;
    const prevP1 = prevBody !== undefined ? findByKey(prevBody, "tpl-p1") : undefined;
    const outP1 = outBody !== undefined ? findByKey(outBody, "tpl-p1") : undefined;
    // tpl-p2 unchanged → reused by reference from prev (FAILS pre-T2: rebuilt).
    expect(outP2).toBe(prevP2);
    // tpl-p1 changed → re-rendered fresh.
    expect(outP1).not.toBe(prevP1);
  });

  it("incremental: unchanged sibling inside a dirty EMBED body is reused by reference (fine-grained)", () => {
    const reg = bodyRegistry();
    const attrs = createDefaultAttrRegistry();

    const state1 = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      embedContents: [
        buildBlock({ id: "emb-body", type: "body-container", firstChildId: "emb-p1", lastChildId: "emb-p2" }),
        buildBlock({ id: "emb-p1", type: "body-para", parentId: "emb-body", nextSiblingId: "emb-p2", inlineContent: inlineContent([text("e1 original")]) }),
        buildBlock({ id: "emb-p2", type: "body-para", parentId: "emb-body", prevSiblingId: "emb-p1", inlineContent: inlineContent([text("e2 original")]) }),
      ],
    });
    const prev = render(state1, reg, attrs);

    const state2 = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      embedContents: [
        buildBlock({ id: "emb-body", type: "body-container", firstChildId: "emb-p1", lastChildId: "emb-p2" }),
        buildBlock({ id: "emb-p1", type: "body-para", parentId: "emb-body", nextSiblingId: "emb-p2", inlineContent: inlineContent([text("e1 EDITED")]) }),
        buildBlock({ id: "emb-p2", type: "body-para", parentId: "emb-body", prevSiblingId: "emb-p1", inlineContent: inlineContent([text("e2 original")]) }),
      ],
    });

    const out = render(state2, reg, attrs, {
      prev,
      prevState: state1,
      dirtyIds: new Set(["emb-p1" as BlockId]),
    });

    const prevBody = prev.embedContents.get("emb-body" as BlockId);
    const outBody = out.embedContents.get("emb-body" as BlockId);
    expect(prevBody).toBeDefined();
    expect(outBody).toBeDefined();
    const prevP2 = prevBody !== undefined ? findByKey(prevBody, "emb-p2") : undefined;
    const outP2 = outBody !== undefined ? findByKey(outBody, "emb-p2") : undefined;
    const prevP1 = prevBody !== undefined ? findByKey(prevBody, "emb-p1") : undefined;
    const outP1 = outBody !== undefined ? findByKey(outBody, "emb-p1") : undefined;
    // emb-p2 unchanged → reused by reference from prev (FAILS pre-T2: rebuilt).
    expect(outP2).toBe(prevP2);
    // emb-p1 changed → re-rendered fresh.
    expect(outP1).not.toBe(prevP1);
  });

  // ── NO-REGRESSION: main-tree fine-grained reuse unaffected by Gap-B change ──
  it("incremental: main-tree unchanged sibling still reused by reference (no regression)", () => {
    const reg = bodyRegistry();
    const attrs = createDefaultAttrRegistry();

    const mainBlocks = () => [
      buildBlock({ id: "doc", type: "document", firstChildId: "m-p1", lastChildId: "m-p2" }),
      buildBlock({ id: "m-p1", type: "paragraph", parentId: "doc", nextSiblingId: "m-p2", inlineContent: inlineContent([text("main p1 original")]) }),
      buildBlock({ id: "m-p2", type: "paragraph", parentId: "doc", prevSiblingId: "m-p1", inlineContent: inlineContent([text("main p2 stable")]) }),
    ];
    const state1 = buildState({ rootId: "doc", blocks: mainBlocks() });
    const prev = render(state1, reg, attrs);

    const state2 = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "m-p1", lastChildId: "m-p2" }),
        buildBlock({ id: "m-p1", type: "paragraph", parentId: "doc", nextSiblingId: "m-p2", inlineContent: inlineContent([text("main p1 EDITED")]) }),
        buildBlock({ id: "m-p2", type: "paragraph", parentId: "doc", prevSiblingId: "m-p1", inlineContent: inlineContent([text("main p2 stable")]) }),
      ],
    });

    const out = render(state2, reg, attrs, {
      prev,
      prevState: state1,
      dirtyIds: new Set(["m-p1" as BlockId]),
    });

    const prevP2 = findByKey(prev.root, "m-p2");
    const outP2 = findByKey(out.root, "m-p2");
    const prevP1 = findByKey(prev.root, "m-p1");
    const outP1 = findByKey(out.root, "m-p1");
    // m-p2 unchanged → reused by reference (already passes; confirms no regression).
    expect(outP2).toBe(prevP2);
    expect(outP1).not.toBe(prevP1);
  });

  // ── #313: ROOT-ONLY top-level entries ───────────────────────────────────
  // The render loops iterate getEmbedContentIds / getTemplateContentIds, which
  // now yield only body ROOTS (parentId === null). A multi-level body's CHILD
  // blocks must NOT appear as standalone top-level RenderOutput entries — they
  // are reached via the root's child chain (rendered IN-BODY). Pre-#313 the
  // accessors returned ALL map ids, so each child was also emitted as a
  // spurious standalone entry with parentComputed=null (wrong cascade context).
  it("full render: a multi-level TEMPLATE body emits ONLY the root entry; children are in-body, not standalone (#313)", () => {
    const reg = bodyRegistry();
    const state = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      templateContents: [
        buildBlock({ id: "tpl-body", type: "body-container", firstChildId: "tpl-p1", lastChildId: "tpl-p2" }),
        buildBlock({ id: "tpl-p1", type: "body-para", parentId: "tpl-body", nextSiblingId: "tpl-p2", inlineContent: inlineContent([text("alpha")]) }),
        buildBlock({ id: "tpl-p2", type: "body-para", parentId: "tpl-body", prevSiblingId: "tpl-p1", inlineContent: inlineContent([text("beta")]) }),
      ],
    });
    const out = render(state, reg, createDefaultAttrRegistry());
    // Only the ROOT is a top-level entry.
    expect(out.templateContents.size).toBe(1);
    expect(out.templateContents.get("tpl-body" as BlockId)).toBeDefined();
    // Children are NOT standalone top-level entries.
    expect(out.templateContents.get("tpl-p1" as BlockId)).toBeUndefined();
    expect(out.templateContents.get("tpl-p2" as BlockId)).toBeUndefined();
    // But they ARE present IN-BODY under the root (regression-lock #285).
    const body = out.templateContents.get("tpl-body" as BlockId);
    expect(firstText(findByKey(body as RenderNode, "tpl-p1"))).toBe("alpha");
    expect(firstText(findByKey(body as RenderNode, "tpl-p2"))).toBe("beta");
  });

  it("full render: a multi-level EMBED body emits ONLY the root entry; children are in-body, not standalone (#313)", () => {
    const reg = bodyRegistry();
    const state = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      embedContents: [
        buildBlock({ id: "emb-body", type: "body-container", firstChildId: "emb-p1", lastChildId: "emb-p2" }),
        buildBlock({ id: "emb-p1", type: "body-para", parentId: "emb-body", nextSiblingId: "emb-p2", inlineContent: inlineContent([text("alpha")]) }),
        buildBlock({ id: "emb-p2", type: "body-para", parentId: "emb-body", prevSiblingId: "emb-p1", inlineContent: inlineContent([text("beta")]) }),
      ],
    });
    const out = render(state, reg, createDefaultAttrRegistry());
    expect(out.embedContents.size).toBe(1);
    expect(out.embedContents.get("emb-body" as BlockId)).toBeDefined();
    expect(out.embedContents.get("emb-p1" as BlockId)).toBeUndefined();
    expect(out.embedContents.get("emb-p2" as BlockId)).toBeUndefined();
    const body = out.embedContents.get("emb-body" as BlockId);
    expect(firstText(findByKey(body as RenderNode, "emb-p1"))).toBe("alpha");
    expect(firstText(findByKey(body as RenderNode, "emb-p2"))).toBe("beta");
  });
});
