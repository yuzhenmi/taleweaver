import { useEffect, useLayoutEffect, useRef, useState, type Dispatch } from "react";
import type { EditorAction, EditorState } from "@taleweaver/core";
import { getActiveFormatting } from "@taleweaver/core";

/** The four toggleable inline styles, derived from the TOGGLE_STYLE action so they track it. */
type ToggleStyle = Extract<EditorAction, { type: "TOGGLE_STYLE" }>["style"];

const GAP = 8;

/** Viewport (client) edges of a rect — the subset of `DOMRect` the placement needs. */
interface Edges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface BubblePos {
  left: number;
  top: number;
}

/**
 * Notion-style placement for the inline formatting menu — kept clear of the text,
 * preferring the selection's bottom-right corner when it fits:
 *   - PRIMARY: anchored to the selection's BOTTOM-RIGHT corner, when the full menu
 *     fits to the right of the selection WITHIN the editor column. (Block coord
 *     clamped into the column so a near-bottom selection shifts up rather than
 *     spilling out the bottom.)
 *   - FALLBACK (no room to the right inside the column — the selection reaches the
 *     column's right edge): OUTSIDE the column, in the right margin, TOP-aligned to
 *     the selection. Never overlaps the text.
 *   - LAST RESORT (no room outside either — a narrow window where the column reaches
 *     the viewport edge): bottom-right of the selection, BOUNDED within the column.
 *
 * All inputs/outputs are viewport (client) coords — the menu is `position:fixed`.
 * `container` is the content column's rect; `viewportWidth` is `window.innerWidth`.
 */
export function computeBubblePosition(
  sel: Edges,
  container: Edges,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  gap: number = GAP,
): BubblePos {
  // PRIMARY: anchored to the selection's bottom-right corner, when the full menu fits
  // to the RIGHT of the selection WITHIN the editor column. The block (vertical) coord
  // is clamped into the column so a selection near the bottom shifts the menu up to fit
  // rather than spilling past the column's bottom edge.
  const brLeft = sel.right + gap;
  if (brLeft + menuWidth <= container.right) {
    return { left: brLeft, top: clamp(sel.bottom + gap, container.top, container.bottom - menuHeight) };
  }
  // FALLBACK: no room to the right inside the column → OUTSIDE the column, in the right
  // margin, top-aligned to the selection (keeps the menu clear of the text).
  const outsideLeft = container.right + gap;
  if (outsideLeft + menuWidth <= viewportWidth) {
    return { left: outsideLeft, top: sel.top };
  }
  // LAST RESORT: no room outside either (a narrow window) → bottom-right of the
  // selection, bounded within the editor column on both axes.
  const left = clamp(sel.right + gap, container.left, container.right - menuWidth);
  const top = clamp(sel.bottom + gap, container.top, container.bottom - menuHeight);
  return { left, top };
}

/** Clamp `v` into `[lo, hi]` (returns `lo` when the range is inverted, i.e. lo > hi). */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

/**
 * Notion/Medium-style inline selection toolbar: a floating pill that appears ABOVE a
 * non-collapsed text selection inside the digital editor and dispatches the same inline-format
 * `EditorAction`s the persistent toolbar does. It reads the browser's live selection rect for
 * positioning (the digital editor IS contenteditable, so `window.getSelection()` is authoritative)
 * and the model's `getActiveFormatting` for active-state highlighting.
 *
 * Step 2 of the digital Notion direction (the persistent toolbar still hosts block-level actions
 * until the slash-menu / block handle land in step 3).
 */
export function SelectionBubble({
  dispatch,
  editorState,
  containerRef,
}: {
  dispatch: Dispatch<EditorAction>;
  editorState: EditorState;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<BubblePos | null>(null);

  useEffect(() => {
    const update = (): void => {
      const sel = window.getSelection();
      const container = containerRef.current;
      if (sel === null || sel.isCollapsed || sel.rangeCount === 0 || container === null) {
        setRect(null);
        return;
      }
      // Only show when BOTH ends of the selection are inside the editor container.
      const { anchorNode, focusNode } = sel;
      if (anchorNode === null || focusNode === null || !container.contains(anchorNode) || !container.contains(focusNode)) {
        setRect(null);
        return;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setRect(r.width === 0 && r.height === 0 ? null : r);
    };
    // Safety net: hide when focus leaves the editor entirely (covers a model-only collapse,
    // e.g. Escape, that may not emit `selectionchange`). Clicking a bubble button keeps focus
    // (its mousedown is prevented), so this does not fire on button presses.
    const hide = (): void => setRect(null);
    const container = containerRef.current;
    document.addEventListener("selectionchange", update);
    // Reposition on scroll (capture: catch the editor's own scroll container) and resize.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    container?.addEventListener("focusout", hide);
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      container?.removeEventListener("focusout", hide);
    };
  }, [containerRef]);

  // Measure the rendered pill and place it (Notion-style) via `computeBubblePosition`.
  // useLayoutEffect runs synchronously pre-paint, so the recomputed `pos` is applied
  // before the browser paints the new selection — no visible jump from a stale position.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const container = containerRef.current;
    if (rect === null || menu === null || container === null) {
      setPos(null);
      return;
    }
    setPos(
      computeBubblePosition(
        rect,
        container.getBoundingClientRect(),
        menu.offsetWidth,
        menu.offsetHeight,
        window.innerWidth,
      ),
    );
  }, [rect, containerRef]);

  if (rect === null) return null;

  const fmt = getActiveFormatting(editorState.state, editorState.selection);
  const styleBtn = (label: string, style: ToggleStyle, active: boolean, extraClass = "") => (
    <button
      type="button"
      // Keep the selection alive: a plain mousedown would move focus out of the editor and
      // collapse the selection before the action runs.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => dispatch({ type: "TOGGLE_STYLE", style })}
      className={`flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm hover:bg-white/15 ${active ? "bg-white/20" : ""} ${extraClass}`}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={menuRef}
      role="toolbar"
      aria-label="Text formatting"
      // Hidden until measured (`pos === null`) so the first frame never flashes at a
      // stale position; `offsetWidth`/`offsetHeight` are still valid while hidden.
      style={{
        position: "fixed",
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos === null ? "hidden" : "visible",
        zIndex: 50,
      }}
      className="flex items-center gap-0.5 rounded-lg bg-gray-900 px-1 py-1 text-white shadow-xl"
    >
      {styleBtn("B", "bold", fmt.bold === true, "font-bold")}
      {styleBtn("I", "italic", fmt.italic === true, "italic")}
      {styleBtn("U", "underline", fmt.underline === true, "underline")}
      {styleBtn("S", "strikethrough", fmt.strikethrough === true, "line-through")}
      <span className="mx-0.5 h-4 w-px bg-white/20" aria-hidden="true" />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => dispatch({ type: "CLEAR_FORMATTING" })}
        className="flex h-7 items-center justify-center rounded px-2 text-xs hover:bg-white/15"
      >
        Clear
      </button>
    </div>
  );
}
