// packages/core/src/cursor/cursor-footnote-page.test.ts
//
// VL-bridge-removal Slice 4 (Bucket C): a caret INSIDE a footnote body must
// resolve its page WITHOUT materializing the whole document. A footnote body
// lives in the `embedContents` tree, so `pageIndexOfBlock` AND
// `pageIndexOfTemplateBlock` both miss it — before Slice 4 a footnote-body caret
// fell to a whole-tree-positioning bridge. Slice 4 adds
// `PagePlan.pageIndexOfFootnoteBlock` + per-page resolution
// (`resolveFootnoteBlockPage`) so `resolvePixelPosition` / `moveToLine` /
// `moveToLineBoundary` resolve a footnote caret per-page.
//
// These tests build the fixture through the REAL footnote producer and keep the
// VIRTUAL tree (NOT a fully-positioned tree), so they exercise the per-page
// resolution path the footnote-caret code actually runs in production.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { buildVirtualPaginatedTree } from "../layout/virtual-producer";
import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
  embed,
} from "@taleweaver/core";
import { createPosition, FOOTNOTE_ANCHOR_EMBED_TYPE } from "@taleweaver/core";
import { collectFootnoteAnchors } from "@taleweaver/core";
import type { State, BlockId } from "@taleweaver/core";
import { resolvePixelPosition } from "./cursor-position";
import { moveToLine, moveToLineBoundary } from "./line-navigation";
import { getLineIndex } from "./line-flatten";

const SHAPER_CHAR_W = 8;
const SHAPER_LINE_H = 16;

const FN_BODY = "fn-body" as BlockId;
const FN_BODY_P = "fn-body-p" as BlockId;

function pageConfig(): PageConfig {
  return {
    pageInlineSize: 320,
    pageBlockSize: 400,
    pageMargins: { blockStart: 60, blockEnd: 60, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

function fnAnchor() {
  return embed(FOOTNOTE_ANCHOR_EMBED_TYPE, { contentBlockId: FN_BODY });
}

interface Built {
  state: State;
  tree: VirtualLayoutTree;
  shaper: TextShaper;
}

function buildDoc(footnoteText: string): Built {
  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "bp0",
        lastChildId: "bp1",
      }),
      buildBlock({
        id: "bp0",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "bp1",
        inlineContent: inlineContent([text("body one")]),
      }),
      buildBlock({
        id: "bp1",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "bp0",
        inlineContent: inlineContent([text("body two"), fnAnchor()]),
      }),
    ],
    embedContents: [
      buildBlock({
        id: FN_BODY,
        type: "footnote-body",
        parentId: null,
        firstChildId: FN_BODY_P,
        lastChildId: FN_BODY_P,
      }),
      buildBlock({
        id: FN_BODY_P,
        type: "paragraph",
        parentId: FN_BODY,
        inlineContent: inlineContent([text(footnoteText)]),
      }),
    ],
  });

  const out = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  );
  const cascadedRoot = cascadePass(out.root);
  if (cascadedRoot.type !== "element") throw new Error("root cascade not element");

  const cascadedEmbedContents = new Map<BlockId, ElementBox>();
  for (const [id, node] of out.embedContents) {
    const c = cascadePass(node as RenderNode);
    if (c.type === "element") cascadedEmbedContents.set(id, c);
  }

  const footnoteAnchors = collectFootnoteAnchors(state);
  expect(footnoteAnchors.map((a) => a.contentBlockId)).toEqual([FN_BODY]);

  const cfg = pageConfig();
  const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
  const tree = buildVirtualPaginatedTree(
    cascadedRoot,
    ctx,
    shaper,
    cfg,
    undefined,
    undefined,
    cascadedEmbedContents,
    footnoteAnchors,
  );

  return { state, tree, shaper };
}

describe("footnote-body caret resolves per-page (no whole-tree materialization)", () => {
  it("the plan maps the footnote body to its carrying page", () => {
    const { tree } = buildDoc("note text");
    // The body's anchor is on the first (only) page, so the body's slot renders
    // on page 0 and the footnote resolver maps it there.
    expect(tree.plan.pageIndexOfFootnoteBlock(FN_BODY)).toBe(0);
    // A non-footnote block is NOT mapped here.
    expect(tree.plan.pageIndexOfFootnoteBlock("bp0" as BlockId)).toBe(-1);
    // A footnote-free doc maps nothing (byte-identical to before footnotes).
    const { tree: noFn } = buildDoc("");
    // Even with an empty footnote body the anchor still creates a body; the
    // semantics are unchanged. Assert the resolver is well-defined either way.
    expect(noFn.plan.pageIndexOfFootnoteBlock("nonexistent" as BlockId)).toBe(-1);
  });

  it("resolvePixelPosition resolves a footnote-body caret per-page", () => {
    const { state, tree, shaper } = buildDoc("note text");
    // Caret at offset 2 inside the footnote body paragraph.
    const pos = createPosition(FN_BODY_P, 2);
    const pixel = resolvePixelPosition(state, pos, tree, shaper);
    expect(pixel).not.toBeNull();
    // The caret resolves onto page 0 (the body's carrying page), inside the
    // footnote slot band (below the body content).
    expect(pixel?.pageIndex).toBe(0);
  });

  it("moveToLineBoundary (Home/End) resolves a footnote-body caret per-page", () => {
    const { state, tree, shaper } = buildDoc("note text");
    const pos = createPosition(FN_BODY_P, 3);
    const start = moveToLineBoundary(state, pos, tree, shaper, "start");
    const end = moveToLineBoundary(state, pos, tree, shaper, "end");
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(start?.blockId).toBe(FN_BODY_P);
    expect(start?.offset).toBe(0);
    expect(end?.blockId).toBe(FN_BODY_P);
    // The single short footnote line ends at the paragraph's content length.
    expect(end?.offset).toBe("note text".length);
  });

  it("moveToLine (Up/Down) within the isolated footnote context is a no-op, per-page", () => {
    const { state, tree, shaper } = buildDoc("note text");
    const pos = createPosition(FN_BODY_P, 2);
    // A single-line footnote body is isolated (its own selection context), so
    // Up/Down stays put (returns null) — the #327 context filter. The point of
    // this test is that it resolves the page per-page.
    const up = moveToLine(state, pos, tree, shaper, "up", null);
    const down = moveToLine(state, pos, tree, shaper, "down", null);
    expect(up).toBeNull();
    expect(down).toBeNull();
  });
});

/**
 * Wrap a tree so EVERY plan page-resolver returns -1 — simulating an UNMAPPED
 * (stale) caret that maps to no page.
 */
function withUnmappedPlan(tree: VirtualLayoutTree): VirtualLayoutTree {
  const plan = {
    ...tree.plan,
    pageIndexOfBlock: () => -1,
    pageIndexOfTemplateBlock: () => -1,
    pageIndexOfFootnoteBlock: () => -1,
    pageSpanOfBlock: () => null,
  };
  return {
    ...tree,
    plan,
  };
}

// ---------------------------------------------------------------------------
// Issue 3 lock: a footnote body that SPLITS across pages. `resolveFootnoteBlockPage`'s
// forward-walk must find the CONTINUATION page's slot fragment — if it regressed to
// always returning the start page, every test above (single-page footnote) still
// passes, so only a split-body fixture catches it.
// ---------------------------------------------------------------------------

const FN_SPLIT_BODY = "fn-split-body" as BlockId;

interface SplitBuilt extends Built {
  /** The footnote body's child paragraph ids, in document order. */
  fnParaIds: BlockId[];
}

/**
 * A SHORT page so a multi-paragraph footnote body's slot can't hold all of its
 * lines on one page and SPLITS its continuation onto later pages' footnote slots.
 * Content band = pageBlockSize − margins; the footnote slot is bounded further
 * (MIN_BODY_BLOCK_SIZE + separator), so a body of several single-line paragraphs
 * spills.
 */
function splitPageConfig(): PageConfig {
  return {
    pageInlineSize: 600,
    pageBlockSize: 64,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 20,
  };
}

/**
 * Build a doc whose single footnote body has `fnParaCount` single-line child
 * paragraphs (so the body's slot splits across ≥2 pages). The main body has
 * enough paragraphs to keep the footnote chain shrinking the per-page slot.
 */
function buildSplitDoc(fnParaCount: number): SplitBuilt {
  const fnParaIds = Array.from(
    { length: fnParaCount },
    (_, i) => `${FN_SPLIT_BODY}-p${i}` as BlockId,
  );
  const fnBodyChildren = fnParaIds.map((id, i) =>
    buildBlock({
      id,
      type: "paragraph",
      parentId: FN_SPLIT_BODY,
      prevSiblingId: i === 0 ? null : fnParaIds[i - 1],
      nextSiblingId: i === fnParaCount - 1 ? null : fnParaIds[i + 1],
      inlineContent: inlineContent([text(`fn line ${i}`)]),
    }),
  );

  // A handful of main-body paragraphs so the footnote chain shares the slot with
  // body content across pages (the slot stays bounded → the body keeps splitting).
  const bodyParaCount = 4;
  const bodyIds = Array.from({ length: bodyParaCount }, (_, i) => `bp${i}`);
  const bodyBlocks = bodyIds.map((id, i) =>
    buildBlock({
      id,
      type: "paragraph",
      parentId: "doc",
      prevSiblingId: i === 0 ? null : bodyIds[i - 1],
      nextSiblingId: i === bodyParaCount - 1 ? null : bodyIds[i + 1],
      // The footnote anchor sits on the FIRST body paragraph (page 0).
      inlineContent:
        i === 0
          ? inlineContent([text("body"), embed(FOOTNOTE_ANCHOR_EMBED_TYPE, { contentBlockId: FN_SPLIT_BODY })])
          : inlineContent([text(`body ${i}`)]),
    }),
  );

  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: bodyIds[0],
        lastChildId: bodyIds[bodyParaCount - 1],
      }),
      ...bodyBlocks,
    ],
    embedContents: [
      buildBlock({
        id: FN_SPLIT_BODY,
        type: "footnote-body",
        parentId: null,
        firstChildId: fnParaIds[0],
        lastChildId: fnParaIds[fnParaCount - 1],
      }),
      ...fnBodyChildren,
    ],
  });

  const out = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry());
  const cascadedRoot = cascadePass(out.root);
  if (cascadedRoot.type !== "element") throw new Error("root cascade not element");

  const cascadedEmbedContents = new Map<BlockId, ElementBox>();
  for (const [id, node] of out.embedContents) {
    const c = cascadePass(node as RenderNode);
    if (c.type === "element") cascadedEmbedContents.set(id, c);
  }

  const footnoteAnchors = collectFootnoteAnchors(state);
  expect(footnoteAnchors.map((a) => a.contentBlockId)).toEqual([FN_SPLIT_BODY]);

  const cfg = splitPageConfig();
  const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
  const tree = buildVirtualPaginatedTree(
    cascadedRoot,
    ctx,
    shaper,
    cfg,
    undefined,
    undefined,
    cascadedEmbedContents,
    footnoteAnchors,
  );

  return { state, tree, shaper, fnParaIds };
}

/**
 * The set of pages that carry ANY line of `blockId` (per-page `byBlock`), via
 * `getPage` only — never the whole document. Used to PROVE a footnote body's slot
 * actually splits (a child paragraph renders on a page > the body's first page).
 */
function pagesCarryingBlock(tree: VirtualLayoutTree, blockId: BlockId): number[] {
  const pages: number[] = [];
  for (let i = 0; i < tree.plan.entries.length; i++) {
    const lines = getLineIndex(tree.getPage(i)).byBlock.get(blockId) ?? [];
    if (lines.length > 0) pages.push(i);
  }
  return pages;
}

describe("footnote body that SPLITS across pages resolves on its continuation page (per-page)", () => {
  // REGRESSION LOCK: `resolveFootnoteBlockPage` must WALK FORWARD past the body's
  // fresh page to the page actually carrying the caret block's lines. A footnote
  // body that splits distributes its child paragraphs across later pages' slots,
  // and per-page `byBlock` is keyed by the leaf child — so the caret's child does
  // NOT have lines on the body's fresh page in general. An earlier version bailed
  // when the child had no lines on the fresh page and clamped to the start page,
  // so a caret in a continuation footnote paragraph resolved to the WRONG page
  // (then `resolveInVirtualTree` found no line there and dev-threw / returned null).
  // This test fails if the walk regresses to that early-bail behavior.
  it("a caret in a footnote child paragraph rendered on a later page resolves to that page", () => {
    // 6 single-line footnote paragraphs on a 64px page ⇒ the body's slot can't
    // fit all 6 lines on page 0, so later paragraphs render on continuation slots.
    const { state, tree, shaper, fnParaIds } = buildSplitDoc(6);

    // PRECONDITION: the footnote body genuinely SPLITS — its slot start page and a
    // LATER continuation page both carry footnote lines (both fragments non-empty).
    const startPage = tree.plan.pageIndexOfFootnoteBlock(FN_SPLIT_BODY);
    expect(startPage).toBeGreaterThanOrEqual(0);

    // Find a footnote child paragraph whose lines render STRICTLY AFTER startPage
    // (a continuation fragment). Pick the last such paragraph for a clear gap.
    let contParaId: BlockId | null = null;
    let contPage = -1;
    for (const id of fnParaIds) {
      const pages = pagesCarryingBlock(tree, id);
      const lastPage = pages.length > 0 ? pages[pages.length - 1] : undefined;
      if (lastPage !== undefined && lastPage > startPage) {
        contParaId = id;
        contPage = lastPage;
      }
    }
    expect(contParaId).not.toBeNull();
    expect(contPage).toBeGreaterThan(startPage); // proves the split (non-empty continuation)
    if (contParaId === null) throw new Error("unreachable");

    // Also assert a footnote paragraph still renders on the START page (the other
    // fragment is non-empty too) — a true split, not the whole body draining off.
    const startFragmentParas = fnParaIds.filter((id) =>
      pagesCarryingBlock(tree, id).includes(startPage),
    );
    expect(startFragmentParas.length).toBeGreaterThan(0);

    // THE LOCK: a caret in the continuation paragraph resolves to its CONTINUATION
    // page (> startPage), proving `resolveFootnoteBlockPage`'s forward-walk found
    // the later fragment — resolved per-page, never the whole tree.
    const pos = createPosition(contParaId, 1);
    const pixel = resolvePixelPosition(state, pos, tree, shaper);
    expect(pixel).not.toBeNull();
    expect(pixel?.pageIndex).toBe(contPage);
    // Strictly greater than the body's first page — a regression that returned the
    // start page (the pre-forward-walk behavior) would FAIL this.
    expect(pixel?.pageIndex).toBeGreaterThan(startPage);
  });
});

describe("unmapped (stale) caret: dev-throws, prod degrades safely (per-page)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("DEV: resolvePixelPosition throws when no page resolver maps the block", () => {
    const { state, tree, shaper } = buildDoc("note text");
    vi.stubEnv("NODE_ENV", "development");
    const guarded = withUnmappedPlan(tree);
    const pos = createPosition(FN_BODY_P, 1);
    expect(() => resolvePixelPosition(state, pos, guarded, shaper)).toThrow(/maps to no page/);
  });

  it("DEV: moveToLine throws when no page resolver maps the block (stale caret)", () => {
    // Issue 2 lock: the dev-throw in `moveToLineVirtual`'s no-page branch.
    // Without it (regressed to a silent `return null`) this would NOT throw, so
    // the stale-caret programmer error would slip through in dev.
    const { state, tree, shaper } = buildDoc("note text");
    vi.stubEnv("NODE_ENV", "development");
    const guarded = withUnmappedPlan(tree);
    const pos = createPosition(FN_BODY_P, 1);
    expect(() => moveToLine(state, pos, guarded, shaper, "up", null)).toThrow(/maps to no page/);
    expect(() => moveToLine(state, pos, guarded, shaper, "down", null)).toThrow(/maps to no page/);
  });

  it("DEV: moveToLineBoundary throws when no page resolver maps the block (stale caret)", () => {
    // Issue 2 lock: the dev-throw in `moveToLineBoundary`'s no-page branch.
    const { state, tree, shaper } = buildDoc("note text");
    vi.stubEnv("NODE_ENV", "development");
    const guarded = withUnmappedPlan(tree);
    const pos = createPosition(FN_BODY_P, 1);
    expect(() => moveToLineBoundary(state, pos, guarded, shaper, "start")).toThrow(/maps to no page/);
    expect(() => moveToLineBoundary(state, pos, guarded, shaper, "end")).toThrow(/maps to no page/);
  });

  it("PROD: resolvePixelPosition returns null (no throw, per-page)", () => {
    const { state, tree, shaper } = buildDoc("note text");
    vi.stubEnv("NODE_ENV", "production");
    const guarded = withUnmappedPlan(tree);
    const pos = createPosition(FN_BODY_P, 1);
    expect(resolvePixelPosition(state, pos, guarded, shaper)).toBeNull();
  });

  it("PROD: moveToLine returns null (caret stays put, no throw, per-page)", () => {
    const { state, tree, shaper } = buildDoc("note text");
    vi.stubEnv("NODE_ENV", "production");
    const guarded = withUnmappedPlan(tree);
    const pos = createPosition(FN_BODY_P, 1);
    expect(moveToLine(state, pos, guarded, shaper, "up", null)).toBeNull();
    expect(moveToLine(state, pos, guarded, shaper, "down", null)).toBeNull();
  });

  it("PROD: moveToLineBoundary returns the input position unchanged (Home/End no-op)", () => {
    const { state, tree, shaper } = buildDoc("note text");
    vi.stubEnv("NODE_ENV", "production");
    const guarded = withUnmappedPlan(tree);
    const pos = createPosition(FN_BODY_P, 1);
    expect(moveToLineBoundary(state, pos, guarded, shaper, "start")).toEqual(pos);
    expect(moveToLineBoundary(state, pos, guarded, shaper, "end")).toEqual(pos);
  });
});
