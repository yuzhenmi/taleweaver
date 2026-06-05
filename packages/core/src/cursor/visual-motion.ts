import type { State, Position, InlineContent } from "../state";
import { resolveBlock } from "../state";
import type { LayoutBox } from "../layout/layout-node";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import type { TextMeasurer } from "../layout/text-measurer";
import {
  getLineIndex,
  findLineForPosition,
  type AbsoluteLineBox,
} from "./line-flatten";
import { resolvePixelPosition } from "./cursor-position";
import type { GraphemeStepper } from "./line-bidi";
import {
  nextGraphemeBoundary,
  prevGraphemeBoundary,
} from "./grapheme-utils";

/** Object Replacement Character — one state unit per embed, for grapheme stepping. */
const EMBED_CHAR = "￼";

/**
 * The `AbsoluteLineBox` containing `position`, or null if it can't be resolved.
 * Handles both the positioned-tree and virtual-tree layouts: for a virtual tree,
 * resolve the position's page via `resolvePixelPosition` (O(1) per the plan), then
 * read that page's lines.
 *
 * Shared by the visual-motion editor handlers (`handleMoveCursor`,
 * `handleExpandSelection`, and `MOVE_LINE_BOUNDARY`) — the position is the moving
 * head (the collapsed caret, or the selection focus) in each case.
 */
export function resolveLineForPosition(
  state: State,
  position: Position,
  layoutTree: LayoutBox | VirtualLayoutTree,
  measurer: TextMeasurer,
  caretPageHint: number | undefined,
): AbsoluteLineBox | null {
  if (layoutTree.type === "virtual-root") {
    const pixel = resolvePixelPosition(
      state,
      position,
      layoutTree,
      measurer,
      caretPageHint,
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
function blockStateText(state: State, blockId: Position["blockId"]): string {
  const block = resolveBlock(state, blockId)?.block ?? null;
  if (block === null || block.inlineContent === null) return "";
  const content: InlineContent = block.inlineContent;
  let out = "";
  for (const item of content.items) {
    out += item.kind === "text" ? item.text : EMBED_CHAR;
  }
  return out;
}

/**
 * A `GraphemeStepper` over the block's STATE-indexed text (see `blockStateText`).
 * The returned stepper walks grapheme boundaries within the block, treating each
 * embed as one atomic unit.
 */
export function buildBlockGraphemeStepper(
  state: State,
  blockId: Position["blockId"],
): GraphemeStepper {
  const blockText = blockStateText(state, blockId);
  return (offset, direction) =>
    direction === "forward"
      ? nextGraphemeBoundary(blockText, offset)
      : prevGraphemeBoundary(blockText, offset);
}
