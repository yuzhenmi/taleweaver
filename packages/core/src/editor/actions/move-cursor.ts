import type { EditorState, EditorConfig } from "../editor-state";
import {
  createSpan,
  spanStart,
  spanEnd,
  type Position,
} from "../../state";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import {
  isTextShaper,
  adaptShaperToMeasurer,
  type TextMeasurer,
} from "../../layout/text-measurer";
import { buildLineBidiView, moveVisually } from "../../cursor/line-bidi";
import {
  resolveLineForPosition,
  buildBlockGraphemeStepper,
} from "../../cursor/visual-motion";

/**
 * Handle `MOVE_CURSOR` (ArrowLeft / ArrowRight) with VISUAL-order caret motion in
 * bidi-reordered lines (P4-C.2.3 §E). The DOM key layer maps the PHYSICAL arrow
 * to `direction` (ArrowRight → `"forward"`, ArrowLeft → `"backward"`), so
 * `direction` is the physical/visual direction here — NOT yet bidi-translated.
 * `moveVisually` performs the bidi translation per the owning run's level parity.
 *
 * - Expanded selection + arrow: collapse to the visual edge per the press
 *   direction (preserves the existing collapse-to-edge behavior; the visual edge
 *   matches the logical edge on uniform lines).
 * - Collapsed caret + arrow: build the current line's `LineBidiView` and call
 *   `moveVisually`, threading `editor.caretAffinity`. On `{ exit }` (motion ran
 *   off the line's visual edge), fall back to `moveByCharacter` in the
 *   PARAGRAPH-logical direction — which advances to the adjacent line / block /
 *   document boundary exactly as before (byte-identical on LTR lines).
 *
 * Pure-LTR / uniform-direction lines reduce to today's logical ±1-grapheme
 * (a uniform-LTR line is one even-level run, so visual-right = logical-forward).
 */
export function handleMoveCursor(
  editor: EditorState,
  direction: "forward" | "backward",
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  const visualDir = direction === "forward" ? "right" : "left";

  // If selection is expanded, collapse to start/end without moving. (Visual edge
  // == logical edge on uniform lines; bidi-precise collapse is C.2.7 territory.)
  if (!isCollapsed(selection)) {
    const pos =
      direction === "forward"
        ? spanEnd(editor.state, selection)
        : spanStart(editor.state, selection);
    return {
      ...editor,
      selection: createSpan(pos, pos),
      caretAffinity: undefined,
      // R5 (#503): MOVE_CURSOR is in `actionManagesAnchorAffinity` (the central
      // reset skips it) AND collapses the selection, so the `...editor` spread
      // would carry a stale `anchorAffinity` forward — clear it explicitly.
      anchorAffinity: undefined,
    };
  }

  const measurer: TextMeasurer = isTextShaper(config.measurer)
    ? adaptShaperToMeasurer(config.measurer)
    : config.measurer;

  const line = resolveLineForPosition(
    editor.state,
    selection.focus,
    editor.layoutTree,
    measurer,
    editor.caretPageHint,
  );
  if (line === null) {
    // No resolvable line (defensive). Fall back to the logical motion.
    const newFocus = moveByCharacter(editor.state, selection.focus, direction);
    return {
      ...editor,
      selection: createSpan(newFocus, newFocus),
      caretAffinity: undefined,
      anchorAffinity: undefined,
    };
  }

  const view = buildLineBidiView(line);
  const step = buildBlockGraphemeStepper(editor.state, selection.focus.blockId);
  const result = moveVisually(view, selection.focus.offset, editor.caretAffinity, visualDir, step);

  if ("exit" in result) {
    // Ran off the line's visual edge. Resolve the adjacent caret via the logical
    // motion (handles soft-wrap to the next line, cross-block, and document
    // boundary). `moveVisually` reports `exitLogicalDir` — the STATE-space
    // direction that continues past the crossed visual edge, accounting for the
    // bidi level of the run AT that edge (visual-left of an RTL run is
    // logical-FORWARD). Using it instead of the physical `direction` stops a
    // pure-RTL run (even one embedded in an LTR paragraph) from warping back
    // into itself. The new caret has no boundary affinity (it lands at a
    // line/block edge, not a within-line bidi boundary).
    // TODO(C.2.7 browser-confirm): when the ADJACENT line's direction differs
    // from this line's, its visual edge may not coincide with the logical-motion
    // target; confirm cross-line bidi motion against Google Docs.
    const newFocus = moveByCharacter(editor.state, selection.focus, result.exitLogicalDir);
    return {
      ...editor,
      selection: createSpan(newFocus, newFocus),
      caretAffinity: undefined,
      anchorAffinity: undefined,
    };
  }

  const newFocus: Position = { blockId: selection.focus.blockId, offset: result.offset };
  return {
    ...editor,
    selection: createSpan(newFocus, newFocus),
    caretAffinity: result.caretAffinity,
    anchorAffinity: undefined,
  };
}
