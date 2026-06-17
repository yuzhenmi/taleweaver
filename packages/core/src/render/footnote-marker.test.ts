import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "./render";
import * as footnotesModule from "../footnotes";
import { insertText } from "../state/ops/insert-text";
import {
  buildFootnoteMarker,
  FOOTNOTE_MARKER_FONT_SCALE,
  FOOTNOTE_MARKER_MISSING_TEXT,
} from "./footnote-marker";
import { createComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { cascadePass } from "../cascade";
import { collectTokens } from "@taleweaver/print";
import { createIntrinsicSizesCache } from "../layout/intrinsic-sizes";
import { createMockShaper } from "../layout/mock-shaper";
import type {
  ContainerComponentDefinition,
  LeafComponentDefinition,
} from "../components/component-definition";
import type { RenderNode, ElementBox, TextBox } from "./render-node";
import { FOOTNOTE_ANCHOR_EMBED_TYPE } from "../state";
import type { BlockId } from "../state";
import {
  footnoteNumbers,
  collectFootnoteAnchors,
} from "../footnotes";
import { insertFootnote } from "../state/ops/insert-footnote";
import { deleteRange } from "../state/ops/delete-range";
import { createPosition } from "../state/block-position";
import { createTestAllocator } from "../state/block-id";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";
import { footnoteBodyComponent } from "../components/footnote-body";

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

const fnBodyComponent: LeafComponentDefinition = {
  type: "fn-body",
  kind: "leaf",
  leafShape: "inline-bearing",
  render: (view, _ctx, inlineChildren) =>
    ({ type: "element", key: view.id, style: { display: "block" }, children: inlineChildren } as RenderNode),
};

// The body root that `insertFootnote` materializes is a `footnote-body`
// CONTAINER; its initial child is a real `paragraph`. Both must be registered
// for the embed-body render walk (used by the incremental renumber test).
const footnoteBodyContainer: ContainerComponentDefinition = {
  type: "footnote-body",
  kind: "container",
  render: (view, _ctx, children) =>
    ({ type: "element", key: view.id, style: { display: "block" }, children } as RenderNode),
};

function basicRegistry() {
  const reg = createComponentRegistry();
  reg.register(documentComponent);
  reg.register(paragraphComponent);
  reg.register(fnBodyComponent);
  reg.register(footnoteBodyContainer);
  return reg;
}

/** An anchor InlineItem whose body root is `bodyId`. */
function anchor(bodyId: string) {
  return {
    kind: "embed" as const,
    embedType: FOOTNOTE_ANCHOR_EMBED_TYPE,
    attrs: {},
    properties: { contentBlockId: bodyId },
  };
}

/** Find the first text descendant string of a RenderNode subtree. */
function firstText(node: RenderNode): string | undefined {
  if (node.type === "text") return node.text;
  for (const child of (node as ElementBox).children) {
    const t = firstText(child);
    if (t !== undefined) return t;
  }
  return undefined;
}

describe("buildFootnoteMarker (unit)", () => {
  it("renders the formatted number as the marker's text content", () => {
    const marker = buildFootnoteMarker("k", {}, "1") as ElementBox;
    expect(marker.type).toBe("element");
    expect(marker.children).toHaveLength(1);
    expect((marker.children[0] as TextBox).text).toBe("1");
  });

  it("marker is inline-block with reduced font-size and raised verticalAlign", () => {
    const marker = buildFootnoteMarker("k", {}, "1") as ElementBox;
    expect(marker.style.display).toBe("inline-block");
    // Reduced font-size — an em fraction of the surrounding text.
    expect(marker.style.fontSize).toEqual({ unit: "em", value: FOOTNOTE_MARKER_FONT_SCALE });
    // Raised relative to baseline: true superscript via vertical-align: super.
    expect(marker.style.verticalAlign).not.toBe("baseline");
    expect(marker.style.verticalAlign).toBe("super");
  });

  it("renders defensively (?) when the number is missing", () => {
    const marker = buildFootnoteMarker("k", {}, undefined) as ElementBox;
    expect((marker.children[0] as TextBox).text).toBe(FOOTNOTE_MARKER_MISSING_TEXT);
  });
});

describe("render — footnote-anchor superscript marker", () => {
  function findAnchorMarker(out: { root: RenderNode }, paraIndex = 0): ElementBox {
    const p = ((out.root as ElementBox).children[paraIndex]) as ElementBox;
    // The first inline child of the paragraph is the marker.
    return p.children[0] as ElementBox;
  }

  it("a single footnote anchor renders a marker showing '1'", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([anchor("fn-1")]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fn-1", type: "fn-body", inlineContent: inlineContent([text("body")]) }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    const marker = findAnchorMarker(out);
    expect(marker.style.display).toBe("inline-block");
    expect(firstText(marker)).toBe("1");
  });

  it("three anchors in document order render '1', '2', '3' (continuous)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a"), anchor("fn-1")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("b"), anchor("fn-2")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("c"), anchor("fn-3")]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn-1", type: "fn-body", inlineContent: inlineContent([text("x")]) }),
        buildBlock({ id: "fn-2", type: "fn-body", inlineContent: inlineContent([text("y")]) }),
        buildBlock({ id: "fn-3", type: "fn-body", inlineContent: inlineContent([text("z")]) }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    // Each paragraph's anchor marker is its SECOND inline child (after the text).
    const m1 = ((out.root as ElementBox).children[0] as ElementBox).children[1] as ElementBox;
    const m2 = ((out.root as ElementBox).children[1] as ElementBox).children[1] as ElementBox;
    const m3 = ((out.root as ElementBox).children[2] as ElementBox).children[1] as ElementBox;
    expect(firstText(m1)).toBe("1");
    expect(firstText(m2)).toBe("2");
    expect(firstText(m3)).toBe("3");
  });

  it("the rendered marker number matches footnoteNumbers for that contentBlockId (threaded, not re-walked)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([anchor("fn-a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([anchor("fn-b")]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn-a", type: "fn-body", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "fn-b", type: "fn-body", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    const numbers = footnoteNumbers(collectFootnoteAnchors(state), {
      reset: "continuous",
      format: "decimal",
    });
    const m1 = nth(((out.root as ElementBox).children[0] as ElementBox).children, 0, "marker 1");
    const m2 = nth(((out.root as ElementBox).children[1] as ElementBox).children, 0, "marker 2");
    expect(firstText(m1)).toBe(numbers.get("fn-a" as BlockId)?.formatted);
    expect(firstText(m2)).toBe(numbers.get("fn-b" as BlockId)?.formatted);
  });

  it("a non-footnote embed (image) is unaffected — still a zero-width, child-less inline-block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            { kind: "embed", embedType: "image", attrs: {}, properties: {} },
          ]),
        }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    const embed = ((out.root as ElementBox).children[0] as ElementBox).children[0] as ElementBox;
    expect(embed.style.display).toBe("inline-block");
    // Unchanged from before FN-2: zero inline-size, no children (no marker text),
    // no superscript font-size / verticalAlign.
    expect(embed.style.inlineSize).toBe(0);
    expect(embed.children).toHaveLength(0);
    expect(embed.style.fontSize).toBeUndefined();
  });
});

describe("render — footnote marker is exactly one cursor stop (IFC offset)", () => {
  it("emits exactly one atomic inline-block token (sourceLength 1) like a plain embed", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([anchor("fn-1")]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fn-1", type: "fn-body", inlineContent: inlineContent([text("body")]) }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    const cascadedRoot = cascadePass(out.root) as ElementBox;
    const para = cascadedRoot.children[0] as ElementBox;
    const shaper = createMockShaper(8, 16);
    const tokens = collectTokens(para, shaper, "ltr", createIntrinsicSizesCache());
    // Exactly one atomic token (the marker inline-block), contributing 1 to the
    // state-model offset cursor — identical to a plain embed.
    const atomicTokens = tokens.filter((t) => t.inlineBlock !== undefined);
    expect(atomicTokens).toHaveLength(1);
    expect(nth(atomicTokens, 0, "atomic token").sourceLength).toBe(1);
  });
});

describe("render — footnote marker geometry (reduced + raised)", () => {
  it("cascaded marker font-size is reduced vs the surrounding paragraph; it lays out raised", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("word"), anchor("fn-1")]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fn-1", type: "fn-body", inlineContent: inlineContent([text("body")]) }),
      ],
    });
    const out = render(state, basicRegistry(), createDefaultAttrRegistry());
    const cascadedRoot = cascadePass(out.root) as ElementBox;
    const para = cascadedRoot.children[0] as ElementBox;
    const paraFontSize = para.computedStyle?.fontSize;
    const markerEl = para.children[1] as ElementBox;
    const markerFontSize = markerEl.computedStyle?.fontSize;
    const markerTextFontSize = (markerEl.children[0] as TextBox).computedStyle?.fontSize;
    expect(typeof paraFontSize).toBe("number");
    expect(typeof markerFontSize).toBe("number");
    // The marker (and its text child) font-size is the reduced fraction of the
    // paragraph's font-size — geometric proof of "smaller", not full-size inline.
    expect(markerFontSize as number).toBeCloseTo((paraFontSize as number) * FOOTNOTE_MARKER_FONT_SCALE, 5);
    expect(markerTextFontSize as number).toBeCloseTo((paraFontSize as number) * FOOTNOTE_MARKER_FONT_SCALE, 5);
    // Raised: true superscript via vertical-align: super (parent-font-relative
    // baseline raise — see ifc.ts applyVerticalAlign).
    expect(markerEl.computedStyle?.verticalAlign).toBe("super");
  });
});

describe("render incremental — downstream markers renumber even when not dirty", () => {
  // Regression for the incremental staleness hazard: inserting a footnote
  // BEFORE existing ones renumbers the downstream anchors, but the state op
  // only dirties the EDITED block. Without invalidating renumbered-anchor
  // blocks, their cached marker RenderNode would show a stale number. We use
  // the real `insertFootnote` op so `dirtyIds` is the authentic minimal set.

  function firstText(node: RenderNode): string | undefined {
    if (node.type === "text") return node.text;
    for (const child of (node as ElementBox).children) {
      const t = firstText(child);
      if (t !== undefined) return t;
    }
    return undefined;
  }

  /**
   * The marker number text for the paragraph block `id` — found by locating the
   * inline-block child whose own child is the marker text (key ends in
   * `/marker-text`), independent of the anchor's offset within the paragraph.
   */
  function markerTextFor(out: { root: RenderNode }, id: string): string | undefined {
    const docChildren = (out.root as ElementBox).children;
    for (const para of docChildren) {
      if (para.key !== id) continue;
      for (const child of (para as ElementBox).children) {
        if (child.type !== "element") continue;
        const marker = child.children.find(
          (c): c is RenderNode => c.key.endsWith("/marker-text"),
        );
        if (marker !== undefined) return firstText(marker);
      }
    }
    return undefined;
  }

  it("inserting a footnote before an existing one bumps the downstream marker from '1' to '2'", () => {
    // Two paragraphs; only p2 has a footnote anchor (its marker is "1").
    const reg = basicRegistry();
    const attrReg = createDefaultAttrRegistry();

    const alloc = createTestAllocator("seed");
    const seeded = insertFootnote(
      buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
          buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("first")]) }),
          buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("second")]) }),
        ],
      }),
      createPosition("p2" as BlockId, 6),
      alloc,
    );
    const prevState = seeded.state;
    const prevRender = render(prevState, reg, attrReg);
    expect(markerTextFor(prevRender, "p2")).toBe("1");

    // Insert a SECOND footnote at the start of p1 — it comes first in document
    // order, so it becomes "1" and p2's anchor renumbers to "2". The op's
    // dirtyIds covers p1 + new body roots, NOT p2.
    const inserted = insertFootnote(prevState, createPosition("p1" as BlockId, 0), alloc);
    expect(inserted.dirtyIds.has("p2" as BlockId)).toBe(false); // precondition

    const nextRender = render(inserted.state, reg, attrReg, {
      prev: prevRender,
      prevState,
      dirtyIds: inserted.dirtyIds,
    });
    // New anchor in p1 → "1"; p2's downstream anchor correctly renumbered → "2".
    expect(markerTextFor(nextRender, "p1")).toBe("1");
    expect(markerTextFor(nextRender, "p2")).toBe("2");
  });

  it("deleting the only footnote removes its marker (footnote-free incremental path)", () => {
    // Exercises the `fnAnchors.length === 0` branch of renderIncremental: when
    // the last footnote is deleted the new state has no anchors, so the
    // renumber diff (and its prevState walk) is skipped entirely. The deleted
    // anchor's own block IS dirtied by deleteRange, so the marker must vanish
    // from the re-rendered paragraph — no stale marker RenderNode survives.
    const reg = basicRegistry();
    const attrReg = createDefaultAttrRegistry();

    const alloc = createTestAllocator("seed");
    const seeded = insertFootnote(
      buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
          buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("second")]) }),
        ],
      }),
      createPosition("p1" as BlockId, 6),
      alloc,
    );
    const prevState = seeded.state;
    const prevRender = render(prevState, reg, attrReg);
    expect(markerTextFor(prevRender, "p1")).toBe("1");

    // Delete the single anchor: it occupies exactly one offset unit at [6, 7).
    const deleted = deleteRange(prevState, {
      anchor: createPosition("p1" as BlockId, 6),
      focus: createPosition("p1" as BlockId, 7),
    });
    expect(deleted.dirtyIds.has("p1" as BlockId)).toBe(true); // precondition
    // No footnote anchors remain after the delete.
    expect(collectFootnoteAnchors(deleted.state).length).toBe(0);

    const nextRender = render(deleted.state, reg, attrReg, {
      prev: prevRender,
      prevState,
      dirtyIds: deleted.dirtyIds,
    });
    // The marker is gone — no inline-block carrying a `/marker-text` child.
    expect(markerTextFor(nextRender, "p1")).toBeUndefined();
  });
});

describe("FN-8: footnote-free incremental render skips the anchor walk", () => {
  // The optimization is OUTPUT-INVISIBLE (a footnote-free doc already rendered
  // an empty numbering map). We assert the DECISION: `collectFootnoteAnchors`
  // (the O(N_blocks) walk) is NOT invoked when the doc has no footnote, and IS
  // invoked when it does. render.ts imports `collectFootnoteAnchors` from
  // "../footnotes"; spying on the module namespace export intercepts that
  // live binding under vitest/ESM. (Verified at authoring time: the spy's
  // call-count tracks render.ts's actual usage — when the guard is removed the
  // footnote-free case's count goes to 1, confirming interception works.)
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const footnoteFreeFixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });

  it("does NOT call collectFootnoteAnchors during a footnote-free incremental render", () => {
    const reg = basicRegistry();
    const attrReg = createDefaultAttrRegistry();
    const state1 = footnoteFreeFixture();
    const prev = render(state1, reg, attrReg);

    // A trivial text edit: dirty the one paragraph. No footnotes anywhere.
    const edited = insertText(state1, createPosition("p" as BlockId, 5), " world", {});
    expect(edited.dirtyIds.has("p" as BlockId)).toBe(true); // precondition

    const spy = vi.spyOn(footnotesModule, "collectFootnoteAnchors");
    render(edited.state, reg, attrReg, {
      prev,
      prevState: state1,
      dirtyIds: edited.dirtyIds,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("DOES call collectFootnoteAnchors during an incremental render when the doc has a footnote", () => {
    const reg = basicRegistry();
    const attrReg = createDefaultAttrRegistry();
    const alloc = createTestAllocator("seed");
    const seeded = insertFootnote(
      footnoteFreeFixture(),
      createPosition("p" as BlockId, 5),
      alloc,
    );
    const prevState = seeded.state;
    const prev = render(prevState, reg, attrReg);

    // A trivial text edit on the same paragraph (footnote still present).
    const edited = insertText(prevState, createPosition("p" as BlockId, 0), "X", {});
    expect(edited.dirtyIds.has("p" as BlockId)).toBe(true); // precondition

    const spy = vi.spyOn(footnotesModule, "collectFootnoteAnchors");
    render(edited.state, reg, attrReg, {
      prev,
      prevState,
      dirtyIds: edited.dirtyIds,
    });
    expect(spy).toHaveBeenCalled();
  });
});

describe("render — footnote body leading number (FN-6.2b: markerText from numbering map)", () => {
  // Uses the REAL footnoteBodyComponent (not the stub above) so the body's
  // markerText is the actual product of ctx.footnoteNumber(view.id). The body
  // root that `insertFootnote` materializes is a `footnote-body` CONTAINER with
  // a `paragraph` child — both must be registered alongside the document.
  function realBodyRegistry() {
    const reg = createComponentRegistry();
    reg.register(documentComponent);
    reg.register(paragraphComponent);
    reg.register(footnoteBodyComponent);
    return reg;
  }

  /** The cascaded ElementBox style for the embed-content body root `id`. */
  function bodyStyle(out: { embedContents: ReadonlyMap<BlockId, RenderNode> }, id: string) {
    const body = out.embedContents.get(id as BlockId);
    if (body === undefined || body.type !== "element") {
      throw new Error(`expected an ElementBox embed body for "${id}"`);
    }
    return body.style;
  }

  it("a single footnote body carries markerText '1.' (the leading number)", () => {
    const reg = realBodyRegistry();
    const attrReg = createDefaultAttrRegistry();
    const alloc = createTestAllocator("seed");
    const inserted = insertFootnote(
      buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
          buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("body")]) }),
        ],
      }),
      createPosition("p" as BlockId, 4),
      alloc,
    );
    const out = render(inserted.state, reg, attrReg);
    expect(bodyStyle(out, inserted.bodyRootId).markerText).toBe("1.");
  });

  it("two footnotes → their bodies carry markerText '1.' and '2.' (document order)", () => {
    const reg = realBodyRegistry();
    const attrReg = createDefaultAttrRegistry();
    const alloc = createTestAllocator("seed");
    // Insert at p1 first (document order earlier) → "1"; then p2 → "2".
    const after1 = insertFootnote(
      buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
          buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
          buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("b")]) }),
        ],
      }),
      createPosition("p1" as BlockId, 1),
      alloc,
    );
    const after2 = insertFootnote(after1.state, createPosition("p2" as BlockId, 1), alloc);

    const out = render(after2.state, reg, attrReg);
    // after1's body is the document-earlier anchor → "1."; after2's → "2.".
    expect(bodyStyle(out, after1.bodyRootId).markerText).toBe("1.");
    expect(bodyStyle(out, after2.bodyRootId).markerText).toBe("2.");
  });

  it("the body's number is the call marker's bare number plus the list-style '.'", () => {
    const reg = realBodyRegistry();
    const attrReg = createDefaultAttrRegistry();
    const alloc = createTestAllocator("seed");
    const inserted = insertFootnote(
      buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
          buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
        ],
      }),
      createPosition("p" as BlockId, 2),
      alloc,
    );
    const out = render(inserted.state, reg, attrReg);
    const numbers = footnoteNumbers(collectFootnoteAnchors(inserted.state), {
      reset: "continuous",
      format: "decimal",
    });
    // The call marker (superscript) is the BARE `formatted` number; the bottom-
    // slot body marker shares that counter value but appends the list-style ".".
    const bare = numbers.get(inserted.bodyRootId)?.formatted;
    expect(bare).toBe("1");
    expect(bodyStyle(out, inserted.bodyRootId).markerText).toBe(`${bare}.`);
  });

  it("a footnote-free render leaves no body markerText (no crash, empty embedContents)", () => {
    const reg = realBodyRegistry();
    const attrReg = createDefaultAttrRegistry();
    const out = render(
      buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
          buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("plain")]) }),
        ],
      }),
      reg,
      attrReg,
    );
    expect(out.embedContents.size).toBe(0);
  });

  it("markerText is offset-excluded: the body's first-paragraph cursor offsets are unchanged by the marker", () => {
    // End-to-end: lay out the cascaded footnote body and confirm the generated
    // MarkerBox carries the number while the body content's own offsets are
    // untouched (the marker is offset-excluded, per FN-6.2a). We assert the
    // marker text is present in the laid-out box AND the body's single
    // paragraph still owns exactly its inline content (no extra offset unit).
    const reg = realBodyRegistry();
    const attrReg = createDefaultAttrRegistry();
    const alloc = createTestAllocator("seed");
    const inserted = insertFootnote(
      buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
          buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("x")]) }),
        ],
      }),
      createPosition("p" as BlockId, 1),
      alloc,
    );
    const out = render(inserted.state, reg, attrReg);
    const body = out.embedContents.get(inserted.bodyRootId);
    if (body === undefined || body.type !== "element") {
      throw new Error("expected an ElementBox embed body");
    }
    // The markerText is set on the body style; the BFC turns it into an
    // offset-excluded MarkerBox at layout time (FN-6.2a, covered by its own
    // tests). Here we assert the render-level contract: markerText present,
    // body content (the paragraph child) intact and not displaced.
    expect(body.style.markerText).toBe("1.");
    expect(body.children).toHaveLength(1);
    expect((body.children[0] as ElementBox).key).toBe(inserted.firstParagraphId);
  });
});

describe("footnote dot is on the BODY marker ONLY, not the call marker", () => {
  // Load-bearing for the split: the inline superscript CALL marker reads like a
  // bare number ("1"), while the bottom-slot BODY marker reads like a numbered-
  // list item ("1."). Both come from the SAME counter value; the "." is the
  // list-style suffix added only on the body side (symbol-exempt). This FAILS
  // on the all-dotted (095f2f3) code where formatCounter dotted everything.
  function realBodyRegistry() {
    const reg = createComponentRegistry();
    reg.register(documentComponent);
    reg.register(paragraphComponent);
    reg.register(footnoteBodyComponent);
    return reg;
  }

  /** The CALL marker (superscript) text in paragraph `id` of the main doc. */
  function callMarkerText(out: { root: RenderNode }, id: string): string | undefined {
    const docChildren = (out.root as ElementBox).children;
    for (const para of docChildren) {
      if (para.key !== id) continue;
      for (const child of (para as ElementBox).children) {
        if (child.type !== "element") continue;
        const marker = child.children.find(
          (c): c is RenderNode => c.key.endsWith("/marker-text"),
        );
        if (marker !== undefined) return firstText(marker);
      }
    }
    return undefined;
  }

  /** The BODY marker (bottom-slot) text — the embed body root's markerText. */
  function bodyMarkerText(
    out: { embedContents: ReadonlyMap<BlockId, RenderNode> },
    id: BlockId,
  ): unknown {
    const body = out.embedContents.get(id);
    if (body === undefined || body.type !== "element") {
      throw new Error(`expected an ElementBox embed body for "${id}"`);
    }
    return body.style.markerText;
  }

  function docWith(format?: string) {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p",
          lastChildId: "p",
          ...(format === undefined ? {} : { attrs: { footnoteNumberingFormat: format } }),
        }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
  }

  it("default decimal: call marker is bare '1', body marker is dotted '1.'", () => {
    const reg = realBodyRegistry();
    const attrReg = createDefaultAttrRegistry();
    const alloc = createTestAllocator("seed");
    const inserted = insertFootnote(docWith(), createPosition("p" as BlockId, 2), alloc);
    const out = render(inserted.state, reg, attrReg);
    // Superscript CALL marker: BARE.
    expect(callMarkerText(out, "p")).toBe("1");
    // Bottom-slot BODY marker: DOTTED.
    expect(bodyMarkerText(out, inserted.bodyRootId)).toBe("1.");
  });

  it("symbol format: BOTH markers are '*' (no dot — symbol is exempt)", () => {
    const reg = realBodyRegistry();
    const attrReg = createDefaultAttrRegistry();
    const alloc = createTestAllocator("seed");
    const inserted = insertFootnote(docWith("symbol"), createPosition("p" as BlockId, 2), alloc);
    const out = render(inserted.state, reg, attrReg);
    expect(callMarkerText(out, "p")).toBe("*");
    expect(bodyMarkerText(out, inserted.bodyRootId)).toBe("*");
  });
});
