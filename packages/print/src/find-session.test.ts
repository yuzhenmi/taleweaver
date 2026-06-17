/**
 * #433 (Find & Replace UI, slice: find SESSION + NAVIGATION): the controller API
 * that makes find functional — `findStart`/`findNext`/`findPrev`/`findClose`.
 *
 * Controller-level (jsdom), real core + real renderer + a spy canvas (mirrors
 * find-highlight-paint.test.ts). Asserts:
 *  - findStart highlights all matches, picks the initial active index = first
 *    match at/after the cursor, and returns the FindStatus.
 *  - cross-context cursor (in a footnote body) vs main-tree matches → no throw,
 *    activeIndex 0.
 *  - findNext/findPrev cycle with WRAP (last→first, first→last); the active
 *    match's rects carry the ACTIVE colour.
 *  - findStart/Next/Prev scroll the active match into view (a scrollable parent's
 *    scrollTop moves; navigation between far-apart matches changes the target).
 *  - findClose clears the highlights AND leaves the document selection UNCHANGED.
 *  - live recompute after a doc edit refreshes the highlights, clamps the
 *    activeIndex, and does NOT scroll; active-match-deleted lands on a survivor.
 *  - zero matches → total 0 / activeIndex -1; next/prev no-op.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createEditorController,
  MATCH_HIGHLIGHT_FILL,
  ACTIVE_MATCH_HIGHLIGHT_FILL,
} from "./index";
import * as core from "@taleweaver/core";

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

const isMatchInactive = (o: Op): boolean =>
  o.kind === "fillRect" && o.fillStyle === MATCH_HIGHLIGHT_FILL;
const isMatchActive = (o: Op): boolean =>
  o.kind === "fillRect" && o.fillStyle === ACTIVE_MATCH_HIGHLIGHT_FILL;

function config(): core.EditorConfig {
  return {
    componentRegistry: core.createDefaultComponentRegistry(),
    attrRegistry: core.createDefaultAttrRegistry(),
    containerWidth: 600,
  };
}

/** A single-paragraph doc: "foo bar foo baz foo" (3 × "foo"). */
function seededEditorState(text: string): core.EditorState {
  const cfg = config();
  let editor = core.createInitialEditorState(cfg);
  editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text }, cfg);
  return editor;
}

describe("find session + navigation (#433)", () => {
  const mounted: HTMLElement[] = [];
  let originalGetContext: PropertyDescriptor | undefined;
  const canvasCtxMap = new WeakMap<HTMLCanvasElement, SpyCtx>();
  let activeCtx: SpyCtx | null = null;

  afterEach(() => {
    if (originalGetContext) {
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
      originalGetContext = undefined;
    }
    for (const el of mounted) el.remove();
    mounted.length = 0;
    activeCtx = null;
  });

  function stubCanvas() {
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
  }

  /** Mount a plain (window-scrolled) controller. */
  function mount(): { container: HTMLElement; lastCtx: () => SpyCtx | null } {
    stubCanvas();
    const container = document.createElement("div");
    document.body.appendChild(container);
    mounted.push(container);
    return { container, lastCtx: () => activeCtx };
  }

  /**
   * Mount a controller inside a scrollable <div> (overflowY:auto) with a short
   * viewport, so `scrollVisualIntoView` produces an observable `scrollTop` move.
   * Stubs the jsdom-zero layout metrics the HTMLElement scroll branch reads.
   */
  function mountScrollable(): {
    container: HTMLElement;
    sp: HTMLElement;
    lastCtx: () => SpyCtx | null;
  } {
    stubCanvas();
    const sp = document.createElement("div");
    sp.style.overflowY = "auto";
    document.body.appendChild(sp);
    mounted.push(sp);
    const container = document.createElement("div");
    sp.appendChild(container);

    sp.scrollTop = 0;
    Object.defineProperty(sp, "clientHeight", { value: 40, configurable: true });
    sp.getBoundingClientRect = vi.fn(() => ({
      left: 0, top: 0, right: 600, bottom: 40, width: 600, height: 40, x: 0, y: 0, toJSON: () => {},
    }));
    // The container's screen-top moves UP as the scroll parent scrolls down (a
    // physically-consistent harness): top = -scrollTop. Without this, a fixed
    // rect would make `scrollCursorIntoView` re-fire forever (the cursor's screen
    // position never reflects the scroll), defeating cursor-scroll convergence.
    container.getBoundingClientRect = vi.fn(() => {
      const top = -sp.scrollTop;
      return { left: 0, top, right: 600, bottom: top + 2000, width: 600, height: 2000, x: 0, y: 0, toJSON: () => {} };
    });
    return { container, sp, lastCtx: () => activeCtx };
  }

  function matchOps(ctx: SpyCtx | null): { inactive: Op[]; active: Op[] } {
    const ops = ctx?._ops ?? [];
    return { inactive: ops.filter(isMatchInactive), active: ops.filter(isMatchActive) };
  }

  // ── findStart ──────────────────────────────────────────────────────────

  it("findStart highlights every match + initial activeIndex = first at/after cursor + status", () => {
    // Cursor starts at the END of the inserted text (offset 19). The first match
    // at/after offset 19 is none → wraps to 0.
    const editor = seededEditorState("foo bar foo baz foo"); // 3 × "foo"
    const { container, lastCtx } = mount();
    const ctrl = createEditorController(container, { measurer, dispatch: vi.fn() });
    ctrl.update(editor);

    const status = ctrl.findStart("foo");
    expect(status).toEqual({ total: 3, activeIndex: 0 });

    // All 3 matches highlighted; one is active.
    const { inactive, active } = matchOps(lastCtx());
    expect(inactive.length).toBeGreaterThan(0);
    expect(active.length).toBeGreaterThan(0);

    ctrl.destroy();
  });

  it("findStart initial activeIndex = first match at/after a mid-document cursor", () => {
    // Move the caret to offset 4 (start of the 2nd word). The first "foo" match
    // at/after offset 4 is the 2nd occurrence (offset 8) → activeIndex 1.
    const cfg = config();
    let editor = seededEditorState("foo bar foo baz foo");
    const blockId = core.getBlock(editor.state, editor.state.rootId)?.firstChildId;
    if (blockId === null || blockId === undefined) throw new Error("no block");
    editor = core.reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: core.createSpan(core.createPosition(blockId, 4), core.createPosition(blockId, 4)),
      },
      cfg,
    );
    const { container } = mount();
    const ctrl = createEditorController(container, { measurer, dispatch: vi.fn() });
    ctrl.update(editor);

    const status = ctrl.findStart("foo");
    expect(status).toEqual({ total: 3, activeIndex: 1 });

    ctrl.destroy();
  });

  it("cross-context: cursor in a footnote body, matches in the main tree → no throw, activeIndex 0", () => {
    // INSERT_FOOTNOTE drops the caret into the footnote body (a different
    // selection context than the main-tree "hello" matches). The first-at/after
    // walk must NOT throw "no common ancestor" — it falls back to activeIndex 0.
    const cfg = config();
    let editor = core.createInitialEditorState(cfg);
    editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: "hello hello" }, cfg);
    editor = core.reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, cfg);
    // Sanity: the caret is now in a different context than the main body.
    const bodyBlockId = core.getBlock(editor.state, editor.state.rootId)?.firstChildId;
    if (bodyBlockId === null || bodyBlockId === undefined) throw new Error("no body block");
    expect(core.selectionContextOf(editor.state, editor.selection.focus.blockId)).not.toBe(
      core.selectionContextOf(editor.state, bodyBlockId),
    );

    const { container } = mount();
    const ctrl = createEditorController(container, { measurer, dispatch: vi.fn() });
    ctrl.update(editor);

    let status: { total: number; activeIndex: number } | undefined;
    expect(() => {
      status = ctrl.findStart("hello");
    }).not.toThrow();
    expect(status).toEqual({ total: 2, activeIndex: 0 });

    ctrl.destroy();
  });

  // ── findNext / findPrev with WRAP ────────────────────────────────────────

  it("findNext cycles 0→1→2→0 (wrap last→first); status advances", () => {
    const editor = seededEditorState("foo bar foo baz foo");
    const { container } = mount();
    const ctrl = createEditorController(container, { measurer, dispatch: vi.fn() });
    ctrl.update(editor);

    expect(ctrl.findStart("foo")).toEqual({ total: 3, activeIndex: 0 });
    expect(ctrl.findNext()).toEqual({ total: 3, activeIndex: 1 });
    expect(ctrl.findNext()).toEqual({ total: 3, activeIndex: 2 });
    expect(ctrl.findNext()).toEqual({ total: 3, activeIndex: 0 }); // wrap

    ctrl.destroy();
  });

  it("findPrev cycles 0→2→1→0 (wrap first→last); status retreats", () => {
    const editor = seededEditorState("foo bar foo baz foo");
    const { container } = mount();
    const ctrl = createEditorController(container, { measurer, dispatch: vi.fn() });
    ctrl.update(editor);

    expect(ctrl.findStart("foo")).toEqual({ total: 3, activeIndex: 0 });
    expect(ctrl.findPrev()).toEqual({ total: 3, activeIndex: 2 }); // wrap first→last
    expect(ctrl.findPrev()).toEqual({ total: 3, activeIndex: 1 });
    expect(ctrl.findPrev()).toEqual({ total: 3, activeIndex: 0 });

    ctrl.destroy();
  });

  it("the active match's rects carry the ACTIVE colour after navigation", () => {
    const editor = seededEditorState("foo bar foo baz foo");
    const { container, lastCtx } = mount();
    const ctrl = createEditorController(container, { measurer, dispatch: vi.fn() });
    ctrl.update(editor);

    ctrl.findStart("foo");
    ctrl.findNext(); // activeIndex 1
    const { inactive, active } = matchOps(lastCtx());
    // 2 inactive (the other matches) + 1 active band on the paragraph's line.
    expect(active.length).toBeGreaterThan(0);
    expect(inactive.length).toBeGreaterThan(0);

    ctrl.destroy();
  });

  // ── Scroll the active match into view ────────────────────────────────────

  it("findStart/findNext scroll the active match into view (scrollTop moves toward the match)", () => {
    vi.useFakeTimers();
    try {
      // Multi-paragraph doc so the 3 matches sit on distinct document-y lines:
      //   p0: "foo"  (y ~ 0)
      //   p1: "x"    (filler)
      //   ... several fillers ...
      //   pN: "foo"  (far down)
      const cfg = config();
      let editor = core.createInitialEditorState(cfg);
      editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: "foo" }, cfg);
      for (let i = 0; i < 8; i++) {
        editor = core.reduceEditor(editor, { type: "SPLIT_NODE" }, cfg);
        editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: "filler" }, cfg);
      }
      editor = core.reduceEditor(editor, { type: "SPLIT_NODE" }, cfg);
      editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: "foo" }, cfg);

      const { container, sp } = mountScrollable();
      const ctrl = createEditorController(container, { measurer, dispatch: vi.fn() });
      ctrl.update(editor);

      // findStart picks the FIRST match at/after the cursor. The cursor is at the
      // end (last paragraph) → no match after → wraps to 0 (the top "foo").
      ctrl.findStart("foo");
      vi.advanceTimersByTime(400);
      const afterStart = sp.scrollTop;

      // findNext → the far-down match → scrollTop must move down to reveal it.
      ctrl.findNext();
      vi.advanceTimersByTime(400);
      const afterNext = sp.scrollTop;

      expect(afterNext).toBeGreaterThan(afterStart);

      ctrl.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── findClose ────────────────────────────────────────────────────────────

  it("findClose clears highlights and leaves the document selection UNCHANGED", () => {
    const editor = seededEditorState("foo bar foo baz foo");
    const { container, lastCtx } = mount();
    const dispatch = vi.fn();
    const ctrl = createEditorController(container, { measurer, dispatch });
    ctrl.update(editor);

    ctrl.findStart("foo");
    ctrl.findNext();

    const ctx = lastCtx();
    if (ctx) ctx._ops.length = 0;
    ctrl.findClose();

    // No match bands painted after close.
    const after = matchOps(lastCtx());
    expect(after.inactive.length).toBe(0);
    expect(after.active.length).toBe(0);
    // "Leaves the document selection UNCHANGED" = the controller issued no
    // selection mutation across the WHOLE find lifecycle (start → nav → close).
    // Asserting dispatch is the real guarantee: the controller holds no reference
    // to the `editor` object, so checking `editor.selection` would be tautological.
    expect(dispatch).not.toHaveBeenCalled();

    ctrl.destroy();
  });

  it("find navigation never dispatches a document-selection action", () => {
    const editor = seededEditorState("foo bar foo baz foo");
    const { container } = mount();
    const dispatch = vi.fn();
    const ctrl = createEditorController(container, { measurer, dispatch });
    ctrl.update(editor);

    ctrl.findStart("foo");
    ctrl.findNext();
    ctrl.findPrev();
    ctrl.findClose();

    expect(dispatch).not.toHaveBeenCalled();

    ctrl.destroy();
  });

  // ── Live recompute (D9) ──────────────────────────────────────────────────

  it("live recompute: an edit while find is active refreshes highlights + clamps activeIndex (in-range)", () => {
    // After an edit while find is active, the session re-queries in update():
    // the highlight set + match COUNT refresh and the activeIndex clamps into
    // the new range (here: still in range, so it's preserved).
    const cfg = config();
    let editor = seededEditorState("foo bar foo baz foo"); // 3 matches
    const { container, lastCtx } = mount();
    const ctrl = createEditorController(container, { measurer, dispatch: vi.fn() });
    ctrl.update(editor);

    ctrl.findStart("foo");
    ctrl.findNext(); // activeIndex 1

    // Edit: append " foo" at the end (caret at the end). The live recompute sees
    // 4 matches; the preserved activeIndex (1) is still in range.
    const ctx0 = lastCtx();
    if (ctx0) ctx0._ops.length = 0;
    editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: " foo" }, cfg);
    ctrl.update(editor);

    // Highlights refreshed: 4 matched bands now paint (3 inactive + 1 active).
    const { inactive, active } = matchOps(lastCtx());
    expect(active.length).toBeGreaterThan(0); // the preserved active match
    expect(inactive.length).toBeGreaterThan(0);
    // The match COUNT is now 4: findNext advances the preserved index 1 → 2.
    expect(ctrl.findNext()).toEqual({ total: 4, activeIndex: 2 });

    ctrl.destroy();
  });

  it("live recompute does NOT scroll the active match into view (it stays in the find-highlight set, not the viewport)", () => {
    vi.useFakeTimers();
    try {
      // Single canvas (window-scrolled) so the active match's position is at a
      // stable doc-y. Pin the caret at the TOP (offset 0) so the cursor scroll is
      // inert. findStart picks the TOP match (index 0). We then drive a live
      // recompute by editing BELOW the caret (changing the match count) while
      // keeping the caret pinned at the top, and assert the recompute did NOT
      // issue a smooth-scroll (no requestAnimationFrame) — only findStart/Next/Prev
      // scroll. The window scroll target for a cursor already at the top is 0, so
      // cursor-scroll never fires; any rAF would be a find-recompute scroll.
      const cfg = config();
      let editor = core.createInitialEditorState(cfg);
      editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: "foo" }, cfg);
      const topBlockId = core.getBlock(editor.state, editor.state.rootId)?.firstChildId;
      if (topBlockId === null || topBlockId === undefined) throw new Error("no top block");
      for (let i = 0; i < 8; i++) {
        editor = core.reduceEditor(editor, { type: "SPLIT_NODE" }, cfg);
        editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: "foo" }, cfg);
      }
      const topSel = core.createSpan(core.createPosition(topBlockId, 0), core.createPosition(topBlockId, 0));
      editor = core.reduceEditor(editor, { type: "SET_SELECTION", selection: topSel }, cfg);

      const { container } = mount(); // window-scrolled; window.scrollY starts at 0
      const ctrl = createEditorController(container, { measurer, dispatch: vi.fn() });
      // Container flush with the window top; the caret at y≈0 needs no scroll.
      container.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0, right: 600, bottom: 2000, width: 600, height: 2000, x: 0, y: 0, toJSON: () => {},
      }));
      ctrl.update(editor);
      vi.advanceTimersByTime(400);

      ctrl.findStart("foo"); // active = top match (index 0), caret at top → no scroll
      vi.advanceTimersByTime(400);

      // Edit below the caret (delete the last paragraph's "foo"), keeping the
      // caret pinned at the top. The live recompute refreshes the matches; with
      // the caret in view at the top, cursor-scroll is inert. The recompute must
      // not smooth-scroll (no rAF scheduled).
      const lastBlockId = core.getBlock(editor.state, editor.state.rootId)?.lastChildId;
      if (lastBlockId === null || lastBlockId === undefined) throw new Error("no last block");
      editor = core.reduceEditor(
        editor,
        {
          type: "SET_SELECTION",
          selection: core.createSpan(core.createPosition(lastBlockId, 0), core.createPosition(lastBlockId, 3)),
        },
        cfg,
      );
      editor = core.reduceEditor(editor, { type: "DELETE_BACKWARD" }, cfg);
      editor = core.reduceEditor(editor, { type: "SET_SELECTION", selection: topSel }, cfg);

      // Install the rAF spy ONLY AFTER the two `advanceTimersByTime(400)` calls
      // above (one after the initial update, one after findStart). 400ms exceeds
      // SCROLL_DURATION, so those drains run the findStart smooth-scroll animation
      // chain to completion BEFORE the spy exists. The spy therefore measures only
      // rAFs scheduled by the live-recompute `update()` below — proving the
      // recompute itself never smooth-scrolls (any leftover findStart rAF would be
      // a false positive, which the pre-drain rules out).
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
      ctrl.update(editor);
      vi.advanceTimersByTime(400);
      expect(rafSpy).not.toHaveBeenCalled(); // no smooth-scroll on the recompute
      rafSpy.mockRestore();

      // The recompute still refreshed the match count (9 → 8).
      expect(ctrl.findNext().total).toBe(8);

      ctrl.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("live recompute: deleting the active match lands the highlight on a surviving match (no throw)", () => {
    const cfg = config();
    // "foo foo" → 2 matches. Active = index 1 (the 2nd). Delete the whole doc's
    // text down to "foo" → only 1 match survives; activeIndex clamps 1 → 0.
    let editor = seededEditorState("foo foo");
    const blockId = core.getBlock(editor.state, editor.state.rootId)?.firstChildId;
    if (blockId === null || blockId === undefined) throw new Error("no block");

    const { container, lastCtx } = mount();
    const ctrl = createEditorController(container, { measurer, dispatch: vi.fn() });
    ctrl.update(editor);

    ctrl.findStart("foo");
    expect(ctrl.findNext()).toEqual({ total: 2, activeIndex: 1 }); // active = 2nd "foo"

    // Delete " foo" (offsets 3..7) — removes the active (2nd) match.
    editor = core.reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: core.createSpan(core.createPosition(blockId, 3), core.createPosition(blockId, 7)),
      },
      cfg,
    );
    editor = core.reduceEditor(editor, { type: "DELETE_BACKWARD" }, cfg);

    const ctx = lastCtx();
    if (ctx) ctx._ops.length = 0;
    expect(() => ctrl.update(editor)).not.toThrow();

    // One match survives, highlighted; the clamped activeIndex (0) is active.
    const { inactive, active } = matchOps(lastCtx());
    expect(active.length).toBeGreaterThan(0);
    expect(inactive.length).toBe(0); // only the single surviving (active) match

    ctrl.destroy();
  });

  // ── Zero matches ─────────────────────────────────────────────────────────

  it("zero matches → total 0, activeIndex -1; next/prev no-op", () => {
    const editor = seededEditorState("foo bar foo baz foo");
    const { container, lastCtx } = mount();
    const ctrl = createEditorController(container, { measurer, dispatch: vi.fn() });
    ctrl.update(editor);

    const status = ctrl.findStart("zzz");
    expect(status).toEqual({ total: 0, activeIndex: -1 });
    // No bands painted.
    expect(matchOps(lastCtx()).inactive.length + matchOps(lastCtx()).active.length).toBe(0);

    // next/prev are no-ops (return the current status).
    expect(ctrl.findNext()).toEqual({ total: 0, activeIndex: -1 });
    expect(ctrl.findPrev()).toEqual({ total: 0, activeIndex: -1 });

    ctrl.destroy();
  });
});
