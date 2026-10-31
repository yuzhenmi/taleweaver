import type { Document, Position, InlineContent } from "@taleweaver/core";
import { resolveBlock } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import type { TextMeasurer } from "@taleweaver/core";
import {
  getLineIndex,
  pickSoftWrapLine,
  type AbsoluteLineBox,
} from "./line-flatten";
import { resolvePixelPosition } from "./cursor-position";
import type { GraphemeStepper, CaretAffinity } from "./line-bidi";
import {
  nextGraphemeBoundary,
  prevGraphemeBoundary,
} from "@taleweaver/core";

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
 *
 * `caretAffinity`: at a soft-wrap boundary the picked line must MATCH the
 * line `cursor-position` renders the caret on for the same affinity — otherwise
 * `moveVisually` builds its `LineBidiView` from the wrong line (a bidi warp at the
 * line seam, the same class of bug at the wrap edge). Threaded down to the shared
 * {@link pickSoftWrapLine} so the picker honors the `"before"` stay-on-current-line
 * opt-out exactly as the cursor-position pickers do.
 */
export function resolveLineForPosition(
  document: Document,
  position: Position,
  layoutTree: LayoutBox | VirtualLayoutTree,
  measurer: TextMeasurer,
  caretPageHint: number | undefined,
  caretAffinity: CaretAffinity | undefined,
): AbsoluteLineBox | null {
  if (layoutTree.type === "virtual-root") {
    const pixel = resolvePixelPosition(
      document,
      position,
      layoutTree,
      measurer,
      caretPageHint,
      caretAffinity,
    );
    if (pixel === null) return null;
    const page = layoutTree.getPage(pixel.pageIndex);
    const ownLines = getLineIndex(page).byBlock.get(position.blockId) ?? [];
    return pickLine(ownLines, position, caretAffinity);
  }

  const ownLines = getLineIndex(layoutTree).byBlock.get(position.blockId) ?? [];
  return pickLine(ownLines, position, caretAffinity);
}

/**
 * Pick the line owning `position` from the block's own lines (in document
 * order), honoring `caretAffinity` at a soft-wrap boundary. Delegates to the
 * shared {@link pickSoftWrapLine} so this matches the line
 * `resolvePositionInOwnLines` renders the caret on — `moveVisually` then operates
 * on the same line the caret is drawn on.
 */
function pickLine(
  ownLines: readonly AbsoluteLineBox[],
  position: Position,
  caretAffinity: CaretAffinity | undefined,
): AbsoluteLineBox | null {
  if (ownLines.length === 0) return null;
  const idx = pickSoftWrapLine(ownLines, position, caretAffinity);
  // Defensive: clamp to the first line when no own-line matched (shouldn't
  // happen — `ownLines` is non-empty and block-filtered).
  const picked = idx >= 0 ? ownLines[idx] : ownLines[0];
  if (picked === undefined) {
    throw new Error(`pickLine: ownLines[${idx >= 0 ? idx : 0}] missing (unreachable)`);
  }
  return picked;
}

/**
 * Build the block's full STATE-indexed text: text items concatenated, each embed
 * a single U+FFFC code unit (one cursor position). Block-relative state offsets
 * index directly into this string, so a grapheme step over it is exactly the
 * within-block ±1-grapheme step (embeds are atomic single-unit graphemes).
 */
function blockDocumentText(document: Document, blockId: Position["blockId"]): string {
  const block = resolveBlock(document, blockId)?.block ?? null;
  if (block === null || block.inlineContent === null) return "";
  const content: InlineContent = block.inlineContent;
  let out = "";
  for (const item of content.items) {
    out += item.kind === "text" ? item.text : EMBED_CHAR;
  }
  return out;
}

/**
 * A `GraphemeStepper` over the block's STATE-indexed text (see `blockDocumentText`).
 * The returned stepper walks grapheme boundaries within the block, treating each
 * embed as one atomic unit.
 */
export function buildBlockGraphemeStepper(
  document: Document,
  blockId: Position["blockId"],
): GraphemeStepper {
  const blockText = blockDocumentText(document, blockId);
  return (offset, direction) =>
    direction === "forward"
      ? nextGraphemeBoundary(blockText, offset)
      : prevGraphemeBoundary(blockText, offset);
}
