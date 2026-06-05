import type { EditorState, EditorConfig } from "../editor-state";
import {
  createSpan,
  spanStart,
  spanEnd,
  resolveBlock,
  type Position,
  type InlineContent,
} from "../../state";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import {
  isTextShaper,
  adaptShaperToMeasurer,
  type TextMeasurer,
} from "../../layout/text-measurer";
import { getLineIndex, findLineForPosition, type AbsoluteLineBox } from "../../cursor/line-flatten";
import { resolvePixelPosition } from "../../cursor/cursor-position";
import {
  buildLineBidiView,
  moveVisually,
  type GraphemeStepper,
} from "../../cursor/line-bidi";
import {
  nextGraphemeBoundary,
  prevGraphemeBoundary,
} from "../../cursor/grapheme-utils";

/** Object Replacement Character — one state unit per embed, for grapheme stepping. */
const EMBED_CHAR = "￼";

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
    return { ...editor, selection: createSpan(pos, pos), caretAffinity: undefined };
  }

  const measurer: TextMeasurer = isTextShaper(config.measurer)
    ? adaptShaperToMeasurer(config.measurer)
    : config.measurer;

  const line = resolveCurrentLine(editor, measurer);
  if (line === null) {
    // No resolvable line (defensive). Fall back to the logical motion.
    const newFocus = moveByCharacter(editor.state, selection.focus, direction);
    return { ...editor, selection: createSpan(newFocus, newFocus), caretAffinity: undefined };
  }

  const view = buildLineBidiView(line);
  const step = blockGraphemeStepper(blockStateText(editor.state, selection.focus.blockId));
  const result = moveVisually(view, selection.focus.offset, editor.caretAffinity, visualDir, step);

  if ("exit" in result) {
    // Ran off the line's visual edge. Resolve the adjacent caret via the logical
    // motion (handles soft-wrap to the next line, cross-block, and document
    // boundary identically to the pre-bidi behavior). The new caret has no
    // boundary affinity (it lands at a line/block edge, not a within-line bidi
    // boundary).
    // TODO(C.2.7 browser-confirm): for a line whose CONTENT direction differs
    // from the paragraph base, the adjacent-line VISUAL edge may differ from the
    // logical-motion target; confirm cross-line bidi motion against Google Docs.
    const newFocus = moveByCharacter(editor.state, selection.focus, direction);
    return { ...editor, selection: createSpan(newFocus, newFocus), caretAffinity: undefined };
  }

  const newFocus: Position = { blockId: selection.focus.blockId, offset: result.offset };
  return {
    ...editor,
    selection: createSpan(newFocus, newFocus),
    caretAffinity: result.caretAffinity,
  };
}

/**
 * The `AbsoluteLineBox` containing `editor.selection.focus`, or null if it can't
 * be resolved. Handles both the positioned-tree and virtual-tree layouts: for a
 * virtual tree, resolve the caret's page via `resolvePixelPosition` (O(1) per
 * the plan), then read that page's lines.
 */
function resolveCurrentLine(editor: EditorState, measurer: TextMeasurer): AbsoluteLineBox | null {
  const position = editor.selection.focus;
  const layoutTree = editor.layoutTree;

  if (layoutTree.type === "virtual-root") {
    const pixel = resolvePixelPosition(
      editor.state,
      position,
      layoutTree,
      measurer,
      editor.caretPageHint,
    );
    if (pixel === null) return null;
    const page = layoutTree.getPage(pixel.pageIndex);
    const ownLines = getLineIndex(page).byBlock.get(position.blockId) ?? [];
    return pickLine(ownLines, position);
  }

  const ownLines = getLineIndex(layoutTree).byBlock.get(position.blockId) ?? [];
  return pickLine(ownLines, position);
}

/**
 * Pick the line owning `position` from the block's own lines (in document
 * order). At an exact line-end boundary prefer the next same-block line (the
 * caret has wrapped onto it) — mirrors `resolvePositionInOwnLines`'s soft-wrap
 * preference so `moveVisually` operates on the line the caret renders on.
 */
function pickLine(
  ownLines: readonly AbsoluteLineBox[],
  position: Position,
): AbsoluteLineBox | null {
  if (ownLines.length === 0) return null;
  const idx = findLineForPosition(ownLines, position);
  if (idx >= 0) {
    const l = ownLines[idx].line;
    if (position.offset === l.inlineOffsetEnd && ownLines[idx + 1] !== undefined) {
      return ownLines[idx + 1];
    }
    return ownLines[idx];
  }
  // Defensive: clamp to the first/last line.
  return ownLines[0];
}

/**
 * Build the block's full STATE-indexed text: text items concatenated, each embed
 * a single U+FFFC code unit (one cursor position). Block-relative state offsets
 * index directly into this string, so a grapheme step over it is exactly the
 * within-block ±1-grapheme step (embeds are atomic single-unit graphemes).
 */
function blockStateText(state: EditorState["state"], blockId: Position["blockId"]): string {
  const block = resolveBlock(state, blockId)?.block ?? null;
  if (block === null || block.inlineContent === null) return "";
  const content: InlineContent = block.inlineContent;
  let out = "";
  for (const item of content.items) {
    out += item.kind === "text" ? item.text : EMBED_CHAR;
  }
  return out;
}

/** A `GraphemeStepper` over a block-relative state string. */
function blockGraphemeStepper(blockText: string): GraphemeStepper {
  return (offset, direction) =>
    direction === "forward"
      ? nextGraphemeBoundary(blockText, offset)
      : prevGraphemeBoundary(blockText, offset);
}
