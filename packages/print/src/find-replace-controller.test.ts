/**
 * #433 (Find & Replace UI, Sub-slice A): the controller replace methods +
 * promoted `findStatus()`.
 *
 * Controller-level (jsdom), real core + real renderer + a spy canvas (mirrors
 * find-session.test.ts). Asserts:
 *  - `replaceActive` with an active match dispatches REPLACE_MATCH carrying the
 *    correct `TextMatch` (`findHighlights.matches[activeIndex]`) + replacement;
 *    feeding the dispatched state back via `update()` live-recomputes and the
 *    activeIndex clamps to the NEXT match (no manual advance, no skip).
 *  - `replaceAll` dispatches REPLACE_ALL with ALL session matches + replacement;
 *    after `update(newState)` the matches recompute (empty for that query) so the
 *    status total drops.
 *  - `findStatus()` returns the right {total, activeIndex} across
 *    findStart/findNext/replace; no session → {0, -1}.
 *  - replaceActive / replaceAll no-op (no dispatch) when no session / no matches.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createEditorController } from "./index";
import * as core from "@taleweaver/core";

const measurer: core.TextMeasurer = core.createMockMeasurer(8, 16);

function config(): core.EditorConfig {
  return {
    componentRegistry: core.createDefaultComponentRegistry(),
    attrRegistry: core.createDefaultAttrRegistry(),
    containerWidth: 600,
  };
}

function seededEditorState(text: string): core.EditorState {
  const cfg = config();
  let editor = core.createInitialEditorState(cfg);
  editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text }, cfg);
  return editor;
}

describe("find/replace controller methods (#433 sub-slice A)", () => {
  const mounted: HTMLElement[] = [];
  let originalGetContext: PropertyDescriptor | undefined;

  afterEach(() => {
    if (originalGetContext) {
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
      originalGetContext = undefined;
    }
    for (const el of mounted) el.remove();
    mounted.length = 0;
  });

  function stubCanvas() {
    originalGetContext = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "getContext",
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: function () {
        return {
          font: "",
          textBaseline: "alphabetic",
          fillStyle: "",
          clearRect() {},
          fillRect() {},
          fillText() {},
          measureText: (t: string) => ({ width: t.length * 8 }),
          setTransform() {},
        };
      },
      writable: true,
      configurable: true,
    });
  }

  function mount(): HTMLElement {
    stubCanvas();
    const container = document.createElement("div");
    document.body.appendChild(container);
    mounted.push(container);
    return container;
  }

  // ── findStatus promotion ─────────────────────────────────────────────────

  it("findStatus() reflects {total, activeIndex} across findStart / findNext", () => {
    const editor = seededEditorState("foo bar foo baz foo"); // 3 × "foo"
    const ctrl = createEditorController(mount(), { measurer, dispatch: vi.fn() });
    ctrl.update(editor);

    // No session yet → {0, -1}.
    expect(ctrl.findStatus()).toEqual({ total: 0, activeIndex: -1 });

    ctrl.findStart("foo");
    expect(ctrl.findStatus()).toEqual({ total: 3, activeIndex: 0 });

    ctrl.findNext();
    expect(ctrl.findStatus()).toEqual({ total: 3, activeIndex: 1 });

    ctrl.findClose();
    expect(ctrl.findStatus()).toEqual({ total: 0, activeIndex: -1 });

    ctrl.destroy();
  });

  // ── replaceActive ────────────────────────────────────────────────────────

  it("replaceActive dispatches REPLACE_MATCH with the active TextMatch + replacement", () => {
    const editor = seededEditorState("foo bar foo baz foo"); // 3 × "foo"
    const blockId = core.getBlock(editor.state, editor.state.rootId)?.firstChildId;
    if (blockId === null || blockId === undefined) throw new Error("no block");
    const dispatch = vi.fn();
    const ctrl = createEditorController(mount(), { measurer, dispatch });
    ctrl.update(editor);

    ctrl.findStart("foo"); // activeIndex 0 (cursor at end → wraps to first)
    expect(ctrl.findStatus()).toEqual({ total: 3, activeIndex: 0 });

    dispatch.mockClear();
    ctrl.replaceActive("XYZ");

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "REPLACE_MATCH",
      // The active TextMatch is findHighlights.matches[0]: the FIRST "foo"
      // occurrence (blockId, start 0, end 3).
      match: { blockId, start: 0, end: 3 },
      replacement: "XYZ",
    });

    ctrl.destroy();
  });

  it("replaceActive does not manually advance; the live recompute clamps to the next match", () => {
    // Replace the active (index 0) "foo" with "qux". After feeding the dispatched
    // state back through update(), the doc is "qux bar foo baz foo" → 2 "foo"
    // matches. The activeIndex was 0 and stays numerically 0 (no manual advance)
    // → it now points at what was the 2nd "foo" (Google Docs "advance after
    // replace"). The match COUNT drops 3 → 2.
    const cfg = config();
    let editor = seededEditorState("foo bar foo baz foo"); // 3 × "foo"
    const ctrl = createEditorController(mount(), {
      measurer,
      dispatch: (action) => {
        editor = core.reduceEditor(editor, action, cfg);
      },
    });
    ctrl.update(editor);

    ctrl.findStart("foo");
    expect(ctrl.findStatus()).toEqual({ total: 3, activeIndex: 0 });

    ctrl.replaceActive("qux"); // dispatch mutates `editor` via reduceEditor
    ctrl.update(editor); // EditorView's [editorState] effect → live recompute

    // 2 "foo" left; activeIndex stayed 0 (now the surviving first "foo"). No
    // manual ++ would have skipped to index 1.
    expect(ctrl.findStatus()).toEqual({ total: 2, activeIndex: 0 });
    // The text actually changed.
    const replacedBlockId = core.getBlock(editor.state, editor.state.rootId)?.firstChildId;
    if (replacedBlockId === null || replacedBlockId === undefined) throw new Error("no block");
    expect(
      core.extractText(
        editor.state,
        core.createSpan(
          core.createPosition(replacedBlockId, 0),
          core.createPosition(replacedBlockId, 3),
        ),
        core.builtinEmbedSerializer,
      ),
    ).toBe("qux");

    ctrl.destroy();
  });

  it("replaceActive at the LAST match clamps activeIndex to the new last index", () => {
    // Navigate to the LAST match (index 2 of 3), replace it with "qux" (which
    // does NOT re-match "foo"). After feeding the dispatched state back, the doc
    // is "foo bar foo baz qux" → 2 "foo" matches. The prior activeIndex was 2,
    // now out of range for length 2, so the live-recompute clamp
    // `Math.min(Math.max(prior, 0), matches.length - 1)` must drop it to the new
    // last index 1 (not stuck at 2, not -1). This pins the Math.min clamp arm.
    const cfg = config();
    let editor = seededEditorState("foo bar foo baz foo"); // 3 × "foo"
    const ctrl = createEditorController(mount(), {
      measurer,
      dispatch: (action) => {
        editor = core.reduceEditor(editor, action, cfg);
      },
    });
    ctrl.update(editor);

    ctrl.findStart("foo");
    ctrl.findNext(); // index 0 → 1
    ctrl.findNext(); // index 1 → 2 (the LAST match)
    expect(ctrl.findStatus()).toEqual({ total: 3, activeIndex: 2 });

    ctrl.replaceActive("qux"); // replace the last "foo"; "qux" does not re-match
    ctrl.update(editor); // live recompute against the new state

    // 2 "foo" left; prior activeIndex 2 is out of range → clamped to new last 1.
    expect(ctrl.findStatus()).toEqual({ total: 2, activeIndex: 1 });

    ctrl.destroy();
  });

  it("replaceActive returns the (pre-refresh) current FindStatus", () => {
    const editor = seededEditorState("foo bar foo baz foo");
    const ctrl = createEditorController(mount(), { measurer, dispatch: vi.fn() });
    ctrl.update(editor);

    ctrl.findStart("foo");
    // dispatch is a vi.fn that never feeds state back, so status is unchanged.
    expect(ctrl.replaceActive("XYZ")).toEqual({ total: 3, activeIndex: 0 });

    ctrl.destroy();
  });

  it("replaceActive is a no-op (no dispatch) when there is no session", () => {
    const editor = seededEditorState("foo bar foo");
    const dispatch = vi.fn();
    const ctrl = createEditorController(mount(), { measurer, dispatch });
    ctrl.update(editor);

    expect(ctrl.replaceActive("XYZ")).toEqual({ total: 0, activeIndex: -1 });
    expect(dispatch).not.toHaveBeenCalled();

    ctrl.destroy();
  });

  it("replaceActive is a no-op (no dispatch) when the session has zero matches", () => {
    const editor = seededEditorState("foo bar foo");
    const dispatch = vi.fn();
    const ctrl = createEditorController(mount(), { measurer, dispatch });
    ctrl.update(editor);

    ctrl.findStart("zzz"); // no matches → activeIndex -1
    dispatch.mockClear();
    expect(ctrl.replaceActive("XYZ")).toEqual({ total: 0, activeIndex: -1 });
    expect(dispatch).not.toHaveBeenCalled();

    ctrl.destroy();
  });

  // ── replaceAll ───────────────────────────────────────────────────────────

  it("replaceAll dispatches REPLACE_ALL with all session matches + replacement", () => {
    const editor = seededEditorState("foo bar foo baz foo"); // 3 × "foo"
    const blockId = core.getBlock(editor.state, editor.state.rootId)?.firstChildId;
    if (blockId === null || blockId === undefined) throw new Error("no block");
    const dispatch = vi.fn();
    const ctrl = createEditorController(mount(), { measurer, dispatch });
    ctrl.update(editor);

    ctrl.findStart("foo");
    dispatch.mockClear();
    ctrl.replaceAll("XYZ");

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "REPLACE_ALL",
      matches: [
        { blockId, start: 0, end: 3 },
        { blockId, start: 8, end: 11 },
        { blockId, start: 16, end: 19 },
      ],
      replacement: "XYZ",
    });

    ctrl.destroy();
  });

  it("replaceAll: after the dispatched state is fed back, the match count drops to 0", () => {
    const cfg = config();
    let editor = seededEditorState("foo bar foo baz foo"); // 3 × "foo"
    const ctrl = createEditorController(mount(), {
      measurer,
      dispatch: (action) => {
        editor = core.reduceEditor(editor, action, cfg);
      },
    });
    ctrl.update(editor);

    ctrl.findStart("foo");
    expect(ctrl.findStatus()).toEqual({ total: 3, activeIndex: 0 });

    ctrl.replaceAll("qux"); // every "foo" → "qux"
    ctrl.update(editor); // live recompute against the new state

    // No "foo" left → total 0.
    expect(ctrl.findStatus()).toEqual({ total: 0, activeIndex: -1 });

    ctrl.destroy();
  });

  it("replaceAll is a no-op (no dispatch) when there is no session", () => {
    const editor = seededEditorState("foo bar foo");
    const dispatch = vi.fn();
    const ctrl = createEditorController(mount(), { measurer, dispatch });
    ctrl.update(editor);

    expect(ctrl.replaceAll("XYZ")).toEqual({ total: 0, activeIndex: -1 });
    expect(dispatch).not.toHaveBeenCalled();

    ctrl.destroy();
  });

  it("replaceAll is a no-op (no dispatch) when the session has zero matches", () => {
    const editor = seededEditorState("foo bar foo");
    const dispatch = vi.fn();
    const ctrl = createEditorController(mount(), { measurer, dispatch });
    ctrl.update(editor);

    ctrl.findStart("zzz");
    dispatch.mockClear();
    expect(ctrl.replaceAll("XYZ")).toEqual({ total: 0, activeIndex: -1 });
    expect(dispatch).not.toHaveBeenCalled();

    ctrl.destroy();
  });
});
