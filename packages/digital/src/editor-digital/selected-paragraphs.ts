import {
  getBlock,
  nextBlockInDocOrder,
  prevBlockInDocOrder,
  recordSample,
  selectionContextOf,
  type BlockId,
  type EditorState,
  type State,
} from "@taleweaver/core";
import { endAnchor } from "../dom-view/render-to-dom";
import type { BlockElementLookup } from "./digital-selection-bridge";

/**
 * The selected-¶ indicator. Every ¶ a selection covers — start ≤ (P, len) and
 * end ≥ (N, 0), i.e. the text blocks from the start's block up to (not including) the
 * end's — is drawn selected at P's END anchor, because the browser's native `::selection`
 * does not paint block ends uniformly: a tracked ¶ glyph / section label is highlighted,
 * any other paragraph gets a generated two-space indicator after its content.
 *
 * Covered set = H(anchor block) XOR H(focus block), where H(b) is "every text block from b
 * on". So a selection change toggles exactly the blocks between the old and new anchor and
 * between the old and new focus (each walked once; a block in both toggles twice = stays):
 * O(changed blocks) per selection change, never a document walk. A document change of
 * known extent (`EditorState.lastChange` made from the last synced State: a local edit or
 * a peer's) does the same endpoint walks and re-judges only its changed blocks against
 * the nearest unchanged one: O(changed blocks), never the selection. An old endpoint
 * whose block the change removed is not walked from; the new endpoint's block is
 * re-judged instead. Only a change of
 * unknown extent (a wholesale replacement) re-derives the covered set.
 */
export interface SelectedParagraphs {
  /** Bring the drawn indicators in line with the editor's selection over its state. */
  sync(editor: EditorState): void;
  /** A block element was (re)mounted: draw its indicator again if its ¶ is selected. */
  mounted(id: BlockId, el: HTMLElement): void;
}

export const SELECTED_MARK_CLASS = "tw-selected-mark";

export function createSelectedParagraphs(
  blockElement: BlockElementLookup,
  /** A block element just received an indicator (the cell clip measures it). */
  onDrawn: (el: HTMLElement) => void,
): SelectedParagraphs {
  const marked = new Set<BlockId>();
  let last: { readonly state: State; readonly anchor: BlockId; readonly focus: BlockId } | null = null;

  function paint(el: HTMLElement, on: boolean): void {
    recordSample("digital.selectedParagraph", 0); // deterministic perf counter (no-op unless tracing)
    const tracked = el.querySelector(":scope > .tw-break-mark");
    if (tracked instanceof HTMLElement) {
      tracked.classList.toggle("tw-selected", on);
      const glyph = tracked.firstElementChild;
      if (glyph instanceof HTMLElement) {
        if (on) glyph.style.setProperty("background-color", "Highlight");
        else glyph.style.removeProperty("background-color");
      }
    } else if (on) {
      if (el.querySelector(`:scope > .${SELECTED_MARK_CLASS}`) === null) {
        // Two spaces wide (print's newline-indicator extent), after the content: before
        // an empty line's filler, a list marker and nested sub-lists.
        const mark = endAnchor(el.ownerDocument, `${SELECTED_MARK_CLASS} tw-selected`, "tw-selected-mark-glyph", "  ", "pointer-events: none; background-color: Highlight");
        el.insertBefore(mark, el.querySelector(":scope > br[data-tw-empty-line], :scope > [data-tw-marker], :scope > ul, :scope > ol"));
      }
    } else {
      el.querySelector(`:scope > .${SELECTED_MARK_CLASS}`)?.remove();
    }
    if (on) onDrawn(el);
  }

  function set(id: BlockId, on: boolean): void {
    if (on) marked.add(id);
    else marked.delete(id);
    const el = blockElement(id);
    if (el !== null) paint(el, on);
  }

  function sync(editor: EditorState): void {
    const { state, selection } = editor;
    const anchor = selection.anchor.blockId;
    const focus = selection.focus.blockId;
    const prev = last;
    last = { state, anchor, focus };
    if (prev !== null && prev.state === state && prev.anchor === anchor && prev.focus === focus) return;
    // A document change with a known extent (the last sync saw the State it was made from).
    const dirty = prev !== null && prev.state !== state && editor.lastChange?.from === prev.state ? editor.lastChange.dirtyIds : null;
    if (prev !== null && (prev.state === state || dirty !== null)) {
      // Toggle between(old, new) endpoint on each side. A long walk that cancels out (a far
      // click) is cut off at the cost of a reset.
      const budget = { steps: 2 * marked.size + 2 * (dirty?.size ?? 0) + 64 };
      // An old endpoint whose block the change removed has nowhere to walk from: its
      // position maps to the deletion's seam, so the blocks between it and the new
      // endpoint are the removed (changed) ones, and only the new endpoint's block is
      // re-judged with them.
      const rejudge = dirty === null ? null : new Set(dirty);
      const side = (from: BlockId, to: BlockId): BlockId[] | null => {
        if (rejudge === null || !rejudge.has(from) || getBlock(state, from) !== null) return between(state, from, to, budget);
        rejudge.add(to);
        return [];
      };
      const a = side(prev.anchor, anchor);
      const f = a === null ? null : side(prev.focus, focus);
      if (a !== null && f !== null) {
        const toggles = new Set<BlockId>();
        for (const id of [...a, ...f]) {
          if (rejudge?.has(id) === true) continue; // re-judged below
          if (toggles.has(id)) toggles.delete(id);
          else toggles.add(id);
        }
        for (const id of toggles) set(id, !marked.has(id));
        if (rejudge === null || judgeDirty(state, rejudge, anchor, focus, budget)) return;
      }
    }
    // Reset: the covered set from scratch, touching only blocks whose state differs.
    const covered = new Set(between(state, anchor, focus, { steps: Infinity }) ?? []);
    for (const id of [...marked]) if (!covered.has(id)) set(id, false);
    for (const id of covered) if (!marked.has(id)) set(id, true);
  }

  /**
   * Re-judge the changed blocks once every unchanged block is right: walking back from a
   * changed block to the nearest unchanged text block (or an already judged one) q, every
   * changed text block on the way is covered iff q is, flipped once per endpoint passed
   * (covered = H(anchor) XOR H(focus)). Each block is walked once: O(changed blocks).
   * False when the walk runs out of budget (the caller resets).
   */
  function judgeDirty(state: State, dirty: ReadonlySet<BlockId>, anchor: BlockId, focus: BlockId, budget: { steps: number }): boolean {
    if (selectionContextOf(state, anchor) !== selectionContextOf(state, focus)) return false;
    const verdict = new Map<BlockId, boolean>();
    for (const id of dirty) {
      if (!isText(state, id)) {
        marked.delete(id); // removed (its element went with it), or not a ¶
        continue;
      }
      if (verdict.has(id)) continue;
      const path: BlockId[] = [];
      let on = false;
      for (let q: BlockId | null = id; q !== null; q = prevBlockInDocOrder(state, q)) {
        recordSample("digital.selectedParagraphWalk", 0); // deterministic perf counter (no-op unless tracing)
        if (--budget.steps < 0) return false;
        const known = verdict.get(q);
        if (known !== undefined) {
          on = known;
          break;
        }
        if (!dirty.has(q) && isText(state, q)) {
          on = marked.has(q);
          break;
        }
        path.push(q);
      }
      for (const q of path.reverse()) {
        if (q === anchor) on = !on;
        if (q === focus) on = !on;
        if (isText(state, q)) verdict.set(q, on);
      }
    }
    for (const [id, on] of verdict) if (marked.has(id) !== on) set(id, on);
    return true;
  }

  function mounted(id: BlockId, el: HTMLElement): void {
    if (marked.has(id)) paint(el, true);
  }

  return { sync, mounted };
}

/**
 * The text blocks in [min(x, y), max(x, y)) in document order, found by walking from x in
 * both directions until y: O(distance). Null when y is not reached within `budget` steps
 * (shared across calls), or x / y are unknown or in different selection contexts.
 */
export function between(state: State, x: BlockId, y: BlockId, budget: { steps: number }): BlockId[] | null {
  if (x === y) return [];
  if (getBlock(state, x) === null || getBlock(state, y) === null) return null;
  if (selectionContextOf(state, x) !== selectionContextOf(state, y)) return null;
  const forward: BlockId[] = [];
  const backward: BlockId[] = [];
  let f: BlockId | null = x;
  let b: BlockId | null = x;
  while ((f !== null || b !== null) && budget.steps > 0) {
    recordSample("digital.selectedParagraphWalk", 0); // deterministic perf counter (no-op unless tracing)
    if (f !== null) {
      budget.steps--;
      if (isText(state, f)) forward.push(f);
      f = nextBlockInDocOrder(state, f);
      if (f === y) return forward;
    }
    if (b !== null) {
      budget.steps--;
      b = prevBlockInDocOrder(state, b);
      if (b !== null && isText(state, b)) backward.push(b);
      if (b === y) return backward;
    }
  }
  return null;
}

const isText = (state: State, id: BlockId): boolean => (getBlock(state, id)?.inlineContent ?? null) !== null;
