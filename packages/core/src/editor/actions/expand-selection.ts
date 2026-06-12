import type { EditorState, EditorConfig } from "../editor-state";
import {
  createSpan,
  type Position,
} from "../../state";
import { expandSelection } from "../../cursor/cursor-ops";
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
    // No resolvable line (defensive). Fall back to the logical focus-extension.
    return logicalExtend(editor, direction);
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
    return logicalExtend(editor, result.exitLogicalDir);
  }

  const newFocus: Position = { blockId: selection.focus.blockId, offset: result.offset };
  return {
    ...editor,
    selection: createSpan(selection.anchor, newFocus),
    caretAffinity: result.caretAffinity,
  };
}

/**
 * Extend the focus via the existing LOGICAL `expandSelection` (anchor fixed),
 * clearing affinity (a logical extension crosses line/block edges, not a
 * within-line bidi boundary).
 */
function logicalExtend(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  const newSelection = expandSelection(editor.state, editor.selection, direction);
  return { ...editor, selection: newSelection, caretAffinity: undefined };
}
