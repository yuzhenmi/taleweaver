import type { EditorState, EditorConfig } from "../editor-state";
import {
  createSpan,
  positionsEqual,
  type Position,
} from "../../state";
import { expandSelection } from "../../cursor/cursor-ops";
import {
  isTextShaper,
  adaptShaperToMeasurer,
  type TextMeasurer,
} from "../../layout/text-measurer";
import { buildLineBidiView, moveVisually, type CaretAffinity } from "../../cursor/line-bidi";
import {
  resolveLineForPosition,
  buildBlockGraphemeStepper,
} from "../../cursor/visual-motion";

/**
 * Handle `EXPAND_SELECTION` (Shift+ArrowLeft / Shift+ArrowRight): extend the
 * selection FOCUS by one VISUAL step in bidi-reordered lines (P4-C.2.4 §E.2),
 * keeping the ANCHOR fixed. This mirrors `handleMoveCursor` (C.2.3) EXACTLY but
 * moves the selection's focus (the moving head) instead of a collapsed caret —
 * so Shift+ArrowRight extends the focus in the SAME visual direction ArrowRight
 * alone moves the caret.
 *
 * The DOM key layer maps the PHYSICAL arrow to `direction` (ArrowRight →
 * `"forward"`, ArrowLeft → `"backward"`); `moveVisually` performs the bidi
 * translation per the focus's owning run's level parity.
 *
 * - In-line result → new focus = `{ ...focus, offset: result.offset }`; the
 *   `caretAffinity` (the focus's boundary side) is threaded into the result and
 *   exempted from the central reset via `actionManagesCaretAffinity`.
 * - `{ exit }` (focus ran off the line's visual edge) → fall back to the logical
 *   focus-extension (`expandSelection` → `moveByCharacter` on the focus), which
 *   preserves cross-line / cross-block / document-boundary extension exactly as
 *   before (byte-identical on LTR lines).
 *
 * Pure-LTR / uniform-direction lines reduce to today's logical ±1-grapheme (a
 * uniform-LTR line is one even-level run, so visual-right = logical-forward), so
 * Shift+ArrowRight extends the focus forward exactly as before this change.
 */
export function handleExpandSelection(
  editor: EditorState,
  direction: "forward" | "backward",
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  const visualDir = direction === "forward" ? "right" : "left";

  // Anchor-affinity seed/persist (#503): on the collapse→extend transition the
  // anchor inherits the caret's bidi-boundary side; on continued extension it
  // PERSISTS. The seed fires ONLY on the genuine first extend out of a fresh caret
  // — `isCollapsed && anchorAffinity === undefined`:
  //   - `isCollapsed` (logically collapsed span) gates against the LTR latching
  //     bug: on a uniform line `moveVisually` stamps an inert focus affinity each
  //     press; once the span is non-collapsed (press 2+) the `!isCollapsed` branch
  //     persists `anchorAffinity` (still undefined for LTR) instead of re-reading
  //     the focus's inert side.
  //   - `anchorAffinity === undefined` gates against the bidi re-seed bug: visually
  //     extending through an RTL run TRANSIENTLY returns the focus to the anchor's
  //     logical offset (the dual-caret press-4 case → a logical, NOT visual,
  //     collapse). Without this guard the next press would treat that as a fresh
  //     caret and overwrite the anchor's original side ("after"→"before"), shrinking
  //     the highlight. With it, an anchor affinity once seeded persists.
  // A fresh caret always has `anchorAffinity === undefined` (cleared by the central
  // reset / SET_SELECTION), so a NEW selection still seeds correctly. Computed
  // BEFORE the null-line check (in-line + visual-exit paths thread it; the defensive
  // null-line fallback passes `undefined`).
  const isCollapsed = positionsEqual(selection.anchor, selection.focus);
  const seedAnchorAffinity = isCollapsed && editor.anchorAffinity === undefined;
  const newAnchorAffinity: CaretAffinity | undefined = seedAnchorAffinity
    ? editor.caretAffinity // seed from the caret's boundary side on first extend
    : editor.anchorAffinity; // persist on continued extension

  const measurer: TextMeasurer = isTextShaper(config.measurer)
    ? adaptShaperToMeasurer(config.measurer)
    : config.measurer;

  const line = resolveLineForPosition(
    editor.state,
    selection.focus,
    editor.layoutTree,
    measurer,
    editor.caretPageHint,
    editor.caretAffinity,
  );
  if (line === null) {
    // No resolvable line (defensive). Fall back to the logical focus-extension;
    // clear anchorAffinity (no resolvable line → no meaningful anchor affinity).
    return logicalExtend(editor, direction, undefined);
  }

  const view = buildLineBidiView(line);
  const step = buildBlockGraphemeStepper(editor.state, selection.focus.blockId);
  const result = moveVisually(view, selection.focus.offset, editor.caretAffinity, visualDir, step);

  if ("exit" in result) {
    // Focus ran off the line's visual edge. Resolve the adjacent focus via the
    // logical extension (handles soft-wrap to the next line, cross-block, and
    // document boundary). `moveVisually` reports `exitLogicalDir` — the
    // STATE-space direction continuing past the crossed visual edge per the bidi
    // level of the run AT that edge (visual-left of an RTL run = logical-FORWARD)
    // — so a pure-RTL run doesn't warp the focus back into itself. The new focus
    // has no boundary affinity (it lands at a line/block edge, not a within-line
    // bidi boundary).
    // TODO(C.2.7 browser-confirm): when the ADJACENT line's direction differs
    // from this line's, its visual edge may not coincide with the logical-motion
    // target; confirm cross-line bidi motion against Google Docs.
    return logicalExtend(editor, result.exitLogicalDir, newAnchorAffinity);
  }

  const newFocus: Position = { blockId: selection.focus.blockId, offset: result.offset };
  return {
    ...editor,
    selection: createSpan(selection.anchor, newFocus),
    caretAffinity: result.caretAffinity,
    anchorAffinity: newAnchorAffinity,
  };
}

/**
 * Extend the focus via the existing LOGICAL `expandSelection` (anchor fixed),
 * clearing the FOCUS affinity (a logical extension crosses line/block edges, not a
 * within-line bidi boundary). The ANCHOR affinity (#503) is threaded by the
 * caller: the visual-exit path persists the seeded/persisted `newAnchorAffinity`
 * (the anchor is unchanged), while the defensive null-line path passes `undefined`
 * (no resolvable line → no meaningful anchor affinity).
 */
function logicalExtend(
  editor: EditorState,
  direction: "forward" | "backward",
  newAnchorAffinity: CaretAffinity | undefined,
): EditorState {
  const newSelection = expandSelection(editor.state, editor.selection, direction);
  return {
    ...editor,
    selection: newSelection,
    caretAffinity: undefined,
    anchorAffinity: newAnchorAffinity,
  };
}
