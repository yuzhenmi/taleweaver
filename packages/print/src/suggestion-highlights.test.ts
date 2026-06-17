/**
 * Change-tracking slice 6b (highlight overlay): paint a pending tracked-change's
 * range as a translucent teal band UNDER the comment highlights, UNDER the
 * find-match highlights, UNDER the selection tint, and UNDER the text — the exact
 * suggestion analog of the comment-highlight overlay. Driven through the real
 * controller + real renderer + a spy canvas (mirrors comment-highlights.test.ts's
 * controller-level harness): the controller stores `{ suggestionId, active }` and
 * RE-RESOLVES each suggestion's range from live state each `update()`.
 *
 * Coverage:
 *  - setSuggestionHighlights over a live suggestion → bands painted.
 *  - active suggestion paints the active colour; inactive the inactive colour.
 *  - a suggestion whose tagged content is gone (range null) → no band.
 *  - clearSuggestionHighlights → no band, and is idempotent (second call no-ops).
 *  - a suggestion spanning a soft line-break → ≥2 rects (multi-rect emission).
 *  - suggestion highlight paints UNDER the comment highlight when both present.
 *  - incremental clear erases the OLD band (addSuggestionHighlightDirty).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  paintCanvas,
  paintPage,
  createPaintCache,
  SUGGESTION_HIGHLIGHT_FILL,
  ACTIVE_SUGGESTION_HIGHLIGHT_FILL,
  COMMENT_HIGHLIGHT_FILL,
  createEditorController,
  type SuggestionHighlightRect,
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

const isSuggestionInactive = (o: Op): boolean =>
  o.kind === "fillRect" && o.fillStyle === SUGGESTION_HIGHLIGHT_FILL;
const isSuggestionActive = (o: Op): boolean =>
  o.kind === "fillRect" && o.fillStyle === ACTIVE_SUGGESTION_HIGHLIGHT_FILL;
const isComment = (o: Op): boolean =>
  o.kind === "fillRect" && o.fillStyle === COMMENT_HIGHLIGHT_FILL;
const isGlyph = (o: Op): boolean => o.kind === "fillText";

/** A suggesting-mode config attributed to "alice" (direct config + author). */
const suggestingConfig: core.EditorConfig = {
  componentRegistry: core.createDefaultComponentRegistry(),
  attrRegistry: core.createDefaultAttrRegistry(),
  containerWidth: 600,
  suggestingAuthor: "alice",
};

/** The first body paragraph id under the document root. */
function bodyParaId(editor: core.EditorState): core.BlockId {
  const root = core.getBlock(editor.state, editor.state.rootId);
  const id = root?.firstChildId;
  if (id === undefined || id === null) throw new Error("no paragraph block");
  return id;
}

/** The number of inline offsets in `paraId` (its content length). */
function paraLength(editor: core.EditorState, paraId: core.BlockId): number {
  const content = core.getBlock(editor.state, paraId)?.inlineContent ?? null;
  return content === null ? 0 : core.inlineContentLength(content);
}

/**
 * Seed an editor and type `text` in SUGGESTING mode at the document start, minting
 * ONE insertion suggestion that tags the whole inserted run. Returns the editor and
 * the minted suggestion's (branded) id (a live, non-empty range).
 */
function seededSuggestion(text: string): { editor: core.EditorState; suggestionId: core.SuggestionId } {
  let editor = core.createInitialEditorState(suggestingConfig);
  editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text }, suggestingConfig);
  const suggestions = core.getSuggestions(editor.state);
  const live = suggestions.find((s) => !s.orphaned);
  if (live === undefined) throw new Error("no live suggestion minted");
  return { editor, suggestionId: live.id };
}

describe("controller setSuggestionHighlights / clearSuggestionHighlights (change-tracking slice 6)", () => {
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

  function suggestionOps(ctx: SpyCtx | null): { inactive: Op[]; active: Op[] } {
    const ops = ctx?._ops ?? [];
    return {
      inactive: ops.filter(isSuggestionInactive),
      active: ops.filter(isSuggestionActive),
    };
  }

  it("setSuggestionHighlights([{ active:false }]) over a live suggestion → inactive bands painted", () => {
    const { editor, suggestionId } = seededSuggestion("hello world foo");
    // The suggestion is live (its tagged run survives).
    expect(core.resolveSuggestionRange(editor.state, suggestionId)).not.toBeNull();

    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(editor);

    controller.setSuggestionHighlights([{ suggestionId, active: false }]);
    const { inactive, active } = suggestionOps(lastCtx());
    expect(inactive.length).toBeGreaterThan(0);
    expect(active.length).toBe(0);

    controller.destroy();
  });

  it("an ACTIVE suggestion paints the active colour; an inactive one the inactive colour", () => {
    // Two distinct insertion suggestions. A DIRECT-mode separator between the two
    // suggesting-mode insertions breaks run-adjacency so they don't coalesce into a
    // single tracked change → two distinct ids, each with its own live range.
    const directConfig = { ...suggestingConfig, suggestingAuthor: null };
    let editor = core.createInitialEditorState(suggestingConfig);
    editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: "hello" }, suggestingConfig);
    const paraId = bodyParaId(editor);
    const sep = paraLength(editor, paraId);
    editor = core.reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: core.createSpan(core.createPosition(paraId, sep), core.createPosition(paraId, sep)) },
      directConfig,
    );
    // Direct (untracked) separator splits the two suggestion runs.
    editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: " sep " }, directConfig);
    const end = paraLength(editor, paraId);
    editor = core.reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: core.createSpan(core.createPosition(paraId, end), core.createPosition(paraId, end)) },
      suggestingConfig,
    );
    editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: "world" }, suggestingConfig);
    const suggestions = core.getSuggestions(editor.state).filter((s) => !s.orphaned);
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    const [s1, s2] = suggestions;
    if (s1 === undefined || s2 === undefined) throw new Error("expected two suggestions");

    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(editor);

    controller.setSuggestionHighlights([
      { suggestionId: s1.id, active: false },
      { suggestionId: s2.id, active: true },
    ]);
    const { inactive, active } = suggestionOps(lastCtx());
    expect(inactive.length).toBeGreaterThan(0);
    expect(active.length).toBeGreaterThan(0);

    controller.destroy();
  });

  it("a suggestion whose tagged content is gone (range null) → no band", () => {
    const { editor, suggestionId } = seededSuggestion("hello");
    // Delete the whole inserted (suggestion-tagged) run, leaving no tagged item →
    // the range index omits the id → resolveSuggestionRange returns null.
    const paraId = bodyParaId(editor);
    let e = core.reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: core.createSpan(
          core.createPosition(paraId, 0),
          core.createPosition(paraId, paraLength(editor, paraId)),
        ),
      },
      // Direct-mode delete (no suggestingAuthor) so the run is hard-removed.
      { ...suggestingConfig, suggestingAuthor: null },
    );
    e = core.reduceEditor(e, { type: "DELETE_FORWARD" }, { ...suggestingConfig, suggestingAuthor: null });
    expect(core.resolveSuggestionRange(e.state, suggestionId)).toBeNull();

    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(e);

    controller.setSuggestionHighlights([{ suggestionId, active: false }]);
    const { inactive, active } = suggestionOps(lastCtx());
    expect(inactive.length).toBe(0);
    expect(active.length).toBe(0);

    controller.destroy();
  });

  it("clearSuggestionHighlights() → no bands afterward, and is idempotent", () => {
    const { editor, suggestionId } = seededSuggestion("hello world foo");

    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(editor);

    controller.setSuggestionHighlights([{ suggestionId, active: false }]);
    expect(suggestionOps(lastCtx()).inactive.length).toBeGreaterThan(0);

    const ctx = lastCtx();
    if (ctx) ctx._ops.length = 0;
    controller.clearSuggestionHighlights();
    const after = suggestionOps(lastCtx());
    expect(after.inactive.length).toBe(0);
    expect(after.active.length).toBe(0);

    // Idempotent: a second clear is a no-op (early-return, no throw, no bands).
    const ctx2 = lastCtx();
    if (ctx2) ctx2._ops.length = 0;
    expect(() => controller.clearSuggestionHighlights()).not.toThrow();
    expect(suggestionOps(lastCtx()).inactive.length).toBe(0);

    controller.destroy();
  });

  it("a suggestion spanning a soft line-break emits ≥2 rects (one band per line)", () => {
    // At 8px/char and containerWidth 600, ~74 chars fit per line. Type a long run in
    // suggesting mode so the single insertion suggestion spans the wrap boundary.
    const word = "wordword "; // 9 chars
    const text = word.repeat(20).trim(); // ~179 chars → wraps across lines
    const { editor, suggestionId } = seededSuggestion(text);
    expect(core.resolveSuggestionRange(editor.state, suggestionId)).not.toBeNull();

    const { container, lastCtx } = mount();
    const controller = createEditorController(container, { measurer, dispatch: vi.fn() });
    controller.update(editor);

    controller.setSuggestionHighlights([{ suggestionId, active: false }]);
    expect(suggestionOps(lastCtx()).inactive.length).toBeGreaterThanOrEqual(2);

    controller.destroy();
  });

  it("renderer paints suggestion band BEFORE comment band BEFORE glyphs (paint order)", () => {
    // Deterministic same-frame ordering, driven straight through the renderer
    // (mirrors comment-highlights.test.ts's renderer-level order test). A single
    // non-incremental paintCanvas with both overlay arrays pins the sequence:
    // suggestion highlight → comment highlight → glyphs.
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

    const suggestions = [
      { x: 0, y: 0, width: 40, height: RUN_HEIGHT, pageIndex: 0, suggestionId: "s1" as core.SuggestionId, active: false },
    ];
    const comments = [
      { x: 0, y: 0, width: 24, height: RUN_HEIGHT, pageIndex: 0, commentId: "c1" as core.CommentId, active: false },
    ];
    paintCanvas(ctx, run, [], [], comments, suggestions, { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);

    const suggestion = ctx._ops.findIndex(isSuggestionInactive);
    const comment = ctx._ops.findIndex(isComment);
    const glyph = ctx._ops.findIndex(isGlyph);
    expect(suggestion).toBeGreaterThanOrEqual(0);
    expect(comment).toBeGreaterThanOrEqual(0);
    expect(glyph).toBeGreaterThanOrEqual(0);
    // Suggestion band is bottommost: painted BEFORE the comment band, BEFORE glyphs.
    expect(suggestion).toBeLessThan(comment);
    expect(comment).toBeLessThan(glyph);
  });
});

// ── Renderer-level: incremental clear/erase (addSuggestionHighlightDirty) ─────
//
// The controller's clearSuggestionHighlights() path repaints with
// `suggestionHighlights: []`. On the INCREMENTAL paint path (a real PaintCache
// holding the prior frame's suggestion-highlight rects), `addSuggestionHighlightDirty`
// must dirty the PRIOR rects' regions so the stale teal band is erased — otherwise
// the layout-reference-equal short-circuit would skip the repaint and the old band
// would linger. The exact suggestion analog of comment-highlights.test.ts's
// incremental-clear test.

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

describe("suggestion-highlight overlay — incremental clear/erase (slice 6)", () => {
  it("clearing suggestion highlights (curr=[]) dirties + clearRects the OLD highlight rects", () => {
    const ctx = createSpyCtx();
    const cache = createPaintCache();
    const page = makePageR();
    const OLD_RECT = { x: 5, y: 7, width: 24, height: RUN_HEIGHT_R };
    const suggestions: SuggestionHighlightRect[] = [
      { ...OLD_RECT, pageIndex: 0, suggestionId: "s1" as core.SuggestionId, active: false },
    ];

    // Frame 1: paint WITH a suggestion highlight so the PaintCache records its rect.
    paintPage(ctx, page, [], [], [], suggestions, null, "hidden", undefined, cache);
    expect(cache.getLastSuggestionHighlightRects()).not.toBeNull();
    expect(ctx._ops.filter(isSuggestionInactive)).toHaveLength(1);

    // Frame 2: SAME (reference-equal) layout tree, but suggestion highlights cleared to
    // []. The only thing that changed is the highlight set → the repaint MUST be
    // driven purely by addSuggestionHighlightDirty dirtying the OLD rect.
    ctx._ops.length = 0;
    const dirty = paintPage(ctx, page, [], [], [], [], null, "hidden", undefined, cache);

    // The OLD suggestion-highlight rect's region was dirtied (so it gets erased)...
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
    // No new suggestion band is painted after the clear.
    expect(ctx._ops.filter((o) => isSuggestionInactive(o) || isSuggestionActive(o))).toHaveLength(0);
    // Cache forgot the old rects (curr=[] recorded).
    expect(cache.getLastSuggestionHighlightRects()).toEqual([]);
  });
});
