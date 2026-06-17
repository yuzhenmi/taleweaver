/**
 * Comments slice 5 (highlight overlay): paint a comment's anchored range as a
 * translucent amber band UNDER the find-match highlights, UNDER the selection
 * tint, and UNDER the text — the exact comment analog of the find-match overlay
 * (#433). Driven through the real controller + real renderer + a spy canvas
 * (mirrors find-highlight-paint.test.ts's controller-level harness): the
 * controller stores `{ commentId, active }` and RE-RESOLVES each comment's range
 * from live state each `update()`.
 *
 * Coverage:
 *  - setCommentHighlights over an existing comment → bands painted.
 *  - active comment paints the active colour; inactive the inactive colour.
 *  - a comment that resolves ORPHANED (one marker deleted) → no band.
 *  - clearCommentHighlights → no band, and is idempotent (second call no-ops).
 *  - a comment spanning a soft line-break → ≥2 rects (multi-rect emission).
 *  - comment highlight paints UNDER the find-match highlight when both present.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  paintCanvas,
  paintPage,
  createPaintCache,
  COMMENT_HIGHLIGHT_FILL,
  ACTIVE_COMMENT_HIGHLIGHT_FILL,
  MATCH_HIGHLIGHT_FILL,
  createEditorController,
  type CommentHighlightRect,
} from "./index";
import * as core from "@taleweaver/core";
import * as printPkg from "./index";

type Op =
  | { kind: "fillRect"; x: number; y: number; w: number; h: number; fillStyle: string }
  | { kind: "fillText"; text: string; x: number; y: number; fillStyle: string }
  | { kind: "clearRect"; x: number; y: number; w: number; h: number };

interface SpyCtx extends CanvasRenderingContext2D {
  _ops: Op[];
}

function createSpyCtx(): SpyCtx {
  const ops: Op[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _ops: Op[] } = {
    _ops: ops,
    canvas: { width: 600, height: 800 } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect(x: number, y: number, w: number, h: number) {
      ops.push({ kind: "clearRect", x, y, w, h });
    },
    fillRect(this: { fillStyle: string }, x: number, y: number, w: number, h: number) {
      ops.push({ kind: "fillRect", x, y, w, h, fillStyle: this.fillStyle });
    },
    fillText(this: { fillStyle: string }, text: string, x: number, y: number) {
      ops.push({ kind: "fillText", text, x, y, fillStyle: this.fillStyle });
    },
    measureText: (t: string) => ({ width: t.length * 8 } as TextMetrics),
    setTransform() {
      /* no-op */
    },
  };
  return ctx as unknown as SpyCtx;
}

const measurer: core.TextMeasurer = core.createMockMeasurer(8, 16);

const isCommentInactive = (o: Op): boolean =>
  o.kind === "fillRect" && o.fillStyle === COMMENT_HIGHLIGHT_FILL;
const isCommentActive = (o: Op): boolean =>
  o.kind === "fillRect" && o.fillStyle === ACTIVE_COMMENT_HIGHLIGHT_FILL;
const isMatch = (o: Op): boolean =>
  o.kind === "fillRect" && o.fillStyle === MATCH_HIGHLIGHT_FILL;
const isGlyph = (o: Op): boolean => o.kind === "fillText";

/** Seed an editor with `text` in one paragraph and return it + that block's id. */
function seededEditorState(text: string): { editor: core.EditorState; blockId: core.BlockId; config: core.EditorConfig } {
  const config: core.EditorConfig = {
    componentRegistry: core.createDefaultComponentRegistry(),
    attrRegistry: core.createDefaultAttrRegistry(),
    containerWidth: 600,
  };
  let editor = core.createInitialEditorState(config);
  editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text }, config);
  const block = core.getBlock(editor.state, editor.state.rootId);
  const blockId = block?.firstChildId;
  if (blockId === null || blockId === undefined) throw new Error("no paragraph block");
  return { editor, blockId, config };
}

/**
 * Mint a comment over `[start, end)` of `blockId`: set the selection there, then
 * dispatch ADD_COMMENT. Returns the post-add editor and the comment id. The id
 * resolves to a live (non-orphaned) range straddling the original selection.
 */
function addComment(
  editor: core.EditorState,
  config: core.EditorConfig,
  blockId: core.BlockId,
  start: number,
  end: number,
  id: string,
): core.EditorState {
  let e = core.reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: core.createSpan(
        core.createPosition(blockId, start),
        core.createPosition(blockId, end),
      ),
    },
    config,
  );
  e = core.reduceEditor(
    e,
    { type: "ADD_COMMENT", id: id as core.CommentId, author: "tester", body: "note", createdAt: 1 },
    config,
  );
  return e;
}

describe("controller setCommentHighlights / clearCommentHighlights (comments slice 5)", () => {
  const containers: HTMLElement[] = [];
  let originalGetContext: PropertyDescriptor | undefined;
  const canvasCtxMap = new WeakMap<HTMLCanvasElement, SpyCtx>();
  let activeCtx: SpyCtx | null = null;

  afterEach(() => {
    if (originalGetContext) {
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
    }
    for (const c of containers) c.remove();
    containers.length = 0;
    activeCtx = null;
  });

  function mount(): { container: HTMLElement; lastCtx: () => SpyCtx | null } {
    originalGetContext = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "getContext",
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: function (this: HTMLCanvasElement) {
        let ctx = canvasCtxMap.get(this);
        if (!ctx) {
          ctx = createSpyCtx();
          canvasCtxMap.set(this, ctx);
        }
        activeCtx = ctx;
        return ctx;
      },
      writable: true,
      configurable: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    return { container, lastCtx: () => activeCtx };
  }

  function commentOps(ctx: SpyCtx | null): { inactive: Op[]; active: Op[] } {
    const ops = ctx?._ops ?? [];
    return {
      inactive: ops.filter(isCommentInactive),
      active: ops.filter(isCommentActive),
    };
  }

  it("setCommentHighlights([{ active:false }]) over an existing comment → inactive bands painted", () => {
    const { editor, blockId, config } = seededEditorState("hello world foo");
    const withComment = addComment(editor, config, blockId, 0, 5, "c1");
    // The comment is live (not orphaned).
    expect(core.resolveCommentRange(withComment.state, "c1" as core.CommentId)?.orphaned).toBe(false);

    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(withComment);

    controller.setCommentHighlights([{ commentId: "c1" as core.CommentId, active: false }]);
    const { inactive, active } = commentOps(lastCtx());
    expect(inactive.length).toBeGreaterThan(0);
    expect(active.length).toBe(0);

    controller.destroy();
  });

  it("an ACTIVE comment paints the active colour; an inactive one the inactive colour", () => {
    const { editor, blockId, config } = seededEditorState("hello world foo bar");
    let e = addComment(editor, config, blockId, 0, 5, "c1");
    // Re-resolve blockId offsets shift after the first comment's markers; mint the
    // second comment over a later range that is still inside the (now-longer) text.
    e = addComment(e, config, blockId, 9, 12, "c2");

    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(e);

    controller.setCommentHighlights([
      { commentId: "c1" as core.CommentId, active: false },
      { commentId: "c2" as core.CommentId, active: true },
    ]);
    const { inactive, active } = commentOps(lastCtx());
    expect(inactive.length).toBeGreaterThan(0);
    expect(active.length).toBeGreaterThan(0);

    controller.destroy();
  });

  it("a comment that resolves ORPHANED (one marker deleted) → no band", () => {
    const { editor, blockId, config } = seededEditorState("hello world foo");
    const withComment = addComment(editor, config, blockId, 0, 5, "c1");

    // Delete the comment's start marker by deleting the whole range that contains
    // it (offsets [0, 1) — the comment-start embed sits at the leading edge). The
    // resulting range has only the end marker → orphaned.
    const range = core.resolveCommentRange(withComment.state, "c1" as core.CommentId);
    expect(range).not.toBeNull();
    if (range === null) throw new Error("no range");
    let e = core.reduceEditor(
      withComment,
      {
        type: "SET_SELECTION",
        selection: core.createSpan(
          core.createPosition(range.start.blockId, range.start.offset),
          core.createPosition(range.start.blockId, range.start.offset + 1),
        ),
      },
      config,
    );
    e = core.reduceEditor(e, { type: "DELETE_FORWARD" }, config);
    expect(core.resolveCommentRange(e.state, "c1" as core.CommentId)?.orphaned).toBe(true);

    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(e);

    controller.setCommentHighlights([{ commentId: "c1" as core.CommentId, active: false }]);
    const { inactive, active } = commentOps(lastCtx());
    expect(inactive.length).toBe(0);
    expect(active.length).toBe(0);

    controller.destroy();
  });

  it("clearCommentHighlights() → no bands afterward, and is idempotent", () => {
    const { editor, blockId, config } = seededEditorState("hello world foo");
    const withComment = addComment(editor, config, blockId, 0, 5, "c1");

    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(withComment);

    controller.setCommentHighlights([{ commentId: "c1" as core.CommentId, active: false }]);
    expect(commentOps(lastCtx()).inactive.length).toBeGreaterThan(0);

    const ctx = lastCtx();
    if (ctx) ctx._ops.length = 0;
    controller.clearCommentHighlights();
    const after = commentOps(lastCtx());
    expect(after.inactive.length).toBe(0);
    expect(after.active.length).toBe(0);

    // Idempotent: a second clear is a no-op (early-return, no throw, no bands).
    const ctx2 = lastCtx();
    if (ctx2) ctx2._ops.length = 0;
    expect(() => controller.clearCommentHighlights()).not.toThrow();
    expect(commentOps(lastCtx()).inactive.length).toBe(0);

    controller.destroy();
  });

  it("a comment spanning a soft line-break emits ≥2 rects (one band per line)", () => {
    // At 8px/char and containerWidth 600, ~74 chars fit per line. Build text long
    // enough that a comment spanning the wrap boundary covers two visual lines.
    const word = "wordword "; // 9 chars
    const text = word.repeat(20).trim(); // ~179 chars → wraps across lines
    const { editor, blockId, config } = seededEditorState(text);
    // Comment from offset 40 to 120 — guaranteed to straddle at least one wrap.
    const withComment = addComment(editor, config, blockId, 40, 120, "c1");
    expect(core.resolveCommentRange(withComment.state, "c1" as core.CommentId)?.orphaned).toBe(false);

    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(withComment);

    controller.setCommentHighlights([{ commentId: "c1" as core.CommentId, active: false }]);
    expect(commentOps(lastCtx()).inactive.length).toBeGreaterThanOrEqual(2);

    controller.destroy();
  });

  it("a comment spanning TWO blocks emits ≥2 rects (one band per block)", () => {
    // Type paragraph 1, split (Enter) into a second paragraph, type paragraph 2,
    // then comment across the block boundary. A cross-block comment range
    // (range.start.blockId !== range.end.blockId) must paint a band in EACH block.
    const { editor, blockId: block1, config } = seededEditorState("first paragraph");
    // Caret sits at the end of "first paragraph" after INSERT_TEXT; Enter there
    // splits a fresh empty paragraph after it.
    let e = core.reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    e = core.reduceEditor(e, { type: "INSERT_TEXT", text: "second paragraph" }, config);

    // The split created a sibling after block1; resolve it as the second block.
    const block2 = core.getBlock(e.state, block1)?.nextSiblingId;
    if (block2 === null || block2 === undefined) throw new Error("no second paragraph block");

    // Select from inside paragraph 1 (offset 6) to inside paragraph 2 (offset 6),
    // a genuine cross-block range, then mint the comment over it.
    e = core.reduceEditor(
      e,
      {
        type: "SET_SELECTION",
        selection: core.createSpan(
          core.createPosition(block1, 6),
          core.createPosition(block2, 6),
        ),
      },
      config,
    );
    e = core.reduceEditor(
      e,
      { type: "ADD_COMMENT", id: "cx" as core.CommentId, author: "tester", body: "note", createdAt: 1 },
      config,
    );
    const range = core.resolveCommentRange(e.state, "cx" as core.CommentId);
    expect(range?.orphaned).toBe(false);
    expect(range?.start.blockId).not.toBe(range?.end.blockId);

    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(e);

    controller.setCommentHighlights([{ commentId: "cx" as core.CommentId, active: false }]);
    // One band per spanned block → at least two rects on the single page.
    expect(commentOps(lastCtx()).inactive.length).toBeGreaterThanOrEqual(2);

    controller.destroy();
  });

  it("renderer paints comment band BEFORE match band BEFORE glyphs (paint order)", () => {
    // Deterministic same-frame ordering, driven straight through the renderer
    // (mirrors find-highlight-paint.test.ts's renderer-level order test). A single
    // non-incremental paintCanvas with both overlay arrays pins the sequence:
    // comment highlight → match highlight → glyphs.
    const ctx = createSpyCtx();
    const RUN_HEIGHT = 16;
    const run = {
      type: "text-run",
      key: "run",
      inlineOffset: 0, blockOffset: 0,
      inlineSize: 100, blockSize: RUN_HEIGHT,
      x: 0, y: 0, width: 100, height: RUN_HEIGHT,
      writingMode: "horizontal-tb", direction: "ltr",
      text: "abc",
      computedStyle: {
        backgroundColor: "transparent", color: "black", fontFamily: "sans-serif",
        fontSize: 16, fontWeight: "normal", fontStyle: "normal",
        underline: false, lineThrough: false, direction: "ltr",
      },
      usedStyle: {
        paddingBlockStart: 0, paddingBlockEnd: 0, paddingInlineStart: 0, paddingInlineEnd: 0,
        borderBlockStartWidth: 0, borderBlockEndWidth: 0, borderInlineStartWidth: 0, borderInlineEndWidth: 0,
        borderBlockStartStyle: "none", borderBlockEndStyle: "none", borderInlineStartStyle: "none", borderInlineEndStyle: "none",
        borderBlockStartColor: "black", borderBlockEndColor: "black", borderInlineStartColor: "black", borderInlineEndColor: "black",
        direction: "ltr", lineHeight: 20, writingMode: "horizontal-tb",
      },
    } as unknown as printPkg.LayoutBox;

    const comments = [
      { x: 0, y: 0, width: 40, height: RUN_HEIGHT, pageIndex: 0, commentId: "c1" as core.CommentId, active: false },
    ];
    const matches = [
      { x: 0, y: 0, width: 24, height: RUN_HEIGHT, pageIndex: 0, active: false },
    ];
    paintCanvas(ctx, run, [], matches, comments, [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);

    const comment = ctx._ops.findIndex(isCommentInactive);
    const match = ctx._ops.findIndex(isMatch);
    const glyph = ctx._ops.findIndex(isGlyph);
    expect(comment).toBeGreaterThanOrEqual(0);
    expect(match).toBeGreaterThanOrEqual(0);
    expect(glyph).toBeGreaterThanOrEqual(0);
    // Comment band is bottommost: painted BEFORE the find-match band, BEFORE glyphs.
    expect(comment).toBeLessThan(match);
    expect(match).toBeLessThan(glyph);
  });
});

// ── Renderer-level: incremental clear/erase (addCommentHighlightDirty) ────────
//
// The controller's clearCommentHighlights() path repaints with `commentHighlights:
// []`. On the INCREMENTAL paint path (a real PaintCache holding the prior frame's
// comment-highlight rects), `addCommentHighlightDirty` must dirty the PRIOR rects'
// regions so the stale amber band is erased — otherwise the layout-reference-equal
// short-circuit would skip the repaint and the old band would linger. This drives
// the true incremental branch (`cache` non-null) end to end: it would FAIL if
// `addCommentHighlightDirty` did not push the prior rects when current highlights
// are empty. The exact comment analog of find-highlight-paint.test.ts's #433
// match-highlight incremental-clear test.

const RUN_HEIGHT_R = 16;
const PAGE_WIDTH_R = 600;
const PAGE_HEIGHT_R = 800;
const BASE_CS_R = {
  backgroundColor: "transparent", color: "black", fontFamily: "sans-serif",
  fontSize: 16, fontWeight: "normal", fontStyle: "normal",
  underline: false, lineThrough: false, direction: "ltr",
};
const BASE_US_R = {
  paddingBlockStart: 0, paddingBlockEnd: 0, paddingInlineStart: 0, paddingInlineEnd: 0,
  borderBlockStartWidth: 0, borderBlockEndWidth: 0, borderInlineStartWidth: 0, borderInlineEndWidth: 0,
  borderBlockStartStyle: "none", borderBlockEndStyle: "none", borderInlineStartStyle: "none", borderInlineEndStyle: "none",
  borderBlockStartColor: "black", borderBlockEndColor: "black", borderInlineStartColor: "black", borderInlineEndColor: "black",
  direction: "ltr", lineHeight: 20, writingMode: "horizontal-tb",
};

function makePageR(): printPkg.LayoutBox {
  const run = {
    type: "text-run",
    key: "run",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: 100, blockSize: RUN_HEIGHT_R,
    x: 0, y: 0, width: 100, height: RUN_HEIGHT_R,
    writingMode: "horizontal-tb", direction: "ltr",
    text: "abc",
    computedStyle: { ...BASE_CS_R },
    usedStyle: { ...BASE_US_R },
  } as unknown as printPkg.LayoutBox;
  const line = {
    type: "line",
    key: "line",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: 100, blockSize: RUN_HEIGHT_R,
    x: 0, y: 0, width: 100, height: RUN_HEIGHT_R,
    writingMode: "horizontal-tb", direction: "ltr",
    baseline: 12, ownerBlockId: "owner", inlineStartOffset: 0,
    children: [run],
    computedStyle: { ...BASE_CS_R },
    usedStyle: { ...BASE_US_R, lineHeight: RUN_HEIGHT_R },
  } as unknown as printPkg.LayoutBox;
  const block = {
    type: "block",
    key: "block",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: 100, blockSize: RUN_HEIGHT_R,
    x: 0, y: 0, width: 100, height: RUN_HEIGHT_R,
    writingMode: "horizontal-tb", direction: "ltr",
    children: [line],
    computedStyle: { ...BASE_CS_R },
    usedStyle: { ...BASE_US_R },
  } as unknown as printPkg.LayoutBox;
  return {
    type: "page",
    key: "page-0",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: PAGE_WIDTH_R, blockSize: PAGE_HEIGHT_R,
    x: 0, y: 0, width: PAGE_WIDTH_R, height: PAGE_HEIGHT_R,
    writingMode: "horizontal-tb", direction: "ltr",
    children: [block],
    pageIndex: 0,
    headerSlot: null, footerSlot: null, footnoteSlot: null,
    computedStyle: { ...BASE_CS_R },
    usedStyle: { ...BASE_US_R },
  } as unknown as printPkg.LayoutBox;
}

const isClearOver = (o: Op, x: number, y: number, w: number, h: number): boolean =>
  o.kind === "clearRect" &&
  o.x <= x && o.y <= y &&
  o.x + o.w >= x + w && o.y + o.h >= y + h;

describe("comment-highlight overlay — incremental clear/erase (slice 5)", () => {
  it("clearing comment highlights (curr=[]) dirties + clearRects the OLD highlight rects", () => {
    const ctx = createSpyCtx();
    const cache = createPaintCache();
    const page = makePageR();
    const OLD_RECT = { x: 5, y: 7, width: 24, height: RUN_HEIGHT_R };
    const comments: CommentHighlightRect[] = [
      { ...OLD_RECT, pageIndex: 0, commentId: "c1" as core.CommentId, active: false },
    ];

    // Frame 1: paint WITH a comment highlight so the PaintCache records its rect.
    paintPage(ctx, page, [], [], comments, [], null, "hidden", undefined, cache);
    expect(cache.getLastCommentHighlightRects()).not.toBeNull();
    expect(ctx._ops.filter(isCommentInactive)).toHaveLength(1);

    // Frame 2: SAME (reference-equal) layout tree, but comment highlights cleared to
    // []. The only thing that changed is the highlight set → the repaint MUST be
    // driven purely by addCommentHighlightDirty dirtying the OLD rect.
    ctx._ops.length = 0;
    const dirty = paintPage(ctx, page, [], [], [], [], null, "hidden", undefined, cache);

    // The OLD comment-highlight rect's region was dirtied (so it gets erased)...
    expect(
      dirty.some(
        (r) =>
          r.x <= OLD_RECT.x && r.y <= OLD_RECT.y &&
          r.x + r.w >= OLD_RECT.x + OLD_RECT.width &&
          r.y + r.h >= OLD_RECT.y + OLD_RECT.height,
      ),
    ).toBe(true);
    // ...and clearRect was actually issued over the OLD coordinates.
    expect(
      ctx._ops.some((o) => isClearOver(o, OLD_RECT.x, OLD_RECT.y, OLD_RECT.width, OLD_RECT.height)),
    ).toBe(true);
    // No new comment band is painted after the clear.
    expect(ctx._ops.filter((o) => isCommentInactive(o) || isCommentActive(o))).toHaveLength(0);
    // Cache forgot the old rects (curr=[] recorded).
    expect(cache.getLastCommentHighlightRects()).toEqual([]);
  });
});
