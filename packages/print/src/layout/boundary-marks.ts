import type { BoundaryMarkMetadata, ComputedStyle, LayoutBoxMetadata, TextMeasurer, TextShaper } from "@taleweaver/core";
import { adaptShaperToMeasurer, axisMapFor, createPosition } from "@taleweaver/core";
import type { LayoutBox, LineBox, MarkerBox } from "./layout-box";
import { createMarkerBox } from "./layout-box";
import type { AbsoluteLineBox } from "../cursor/line-flatten";
import { buildLineBidiView } from "../cursor/line-bidi";
import { resolvePositionInOwnLines } from "../cursor/cursor-position";

/**
 * The tracked ¶ box (`metadata.endMark`, change tracking) for one batch of a text
 * block's IFC lines, in the block's child frame: the ¶ glyph, or — for a section
 * kind (a section-end item) — Word's section-break label over the line remainder.
 *
 * The glyph is anchored at the CARET paint position of `(block, len)` on the
 * block's last line — resolved by the caret geometry itself (bidi, the
 * trailing-space clamp, vertical writing mode, the empty line) — and advances
 * along the line's base inline direction from there. It takes no line space, never
 * reflows, and may HANG past the content edge (Word hangs the ¶ past the margin).
 * Where an inline-end float narrows the line (`LineBox.endsAtFloat`, set by the IFC), its
 * visible extent is capped at the line end — the float's
 * margin box (`maxInlineSize`); ancestor clips (cell border box, column gap, page
 * box) are applied by the boundary-mark index. A fragment that does not hold the
 * block's last line gets no ¶. A section kind spans from the caret to the line
 * end (at least one ¶ glyph wide); its label is centred in it. Style: the block's
 * last text run (the block style when empty), underlined for insertion kinds,
 * struck for join kinds, in the suggestion's author colour.
 */
export function boundaryMarkBoxes(
  lines: readonly LayoutBox[],
  metadata: LayoutBoxMetadata | undefined,
  shaper: TextShaper,
): MarkerBox[] {
  const mark = metadata?.endMark;
  if (mark === undefined) return [];
  const own = lines.filter((l): l is LineBox => l.type === "line");
  const last = own[own.length - 1];
  if (last === undefined || !last.isBlockBoundaryLine) return [];
  return [endMarkBox(mark, last, own, lastRunStyle(last), adaptShaperToMeasurer(shaper))];
}

function endMarkBox(
  mark: BoundaryMarkMetadata,
  line: LineBox,
  lines: readonly LineBox[],
  runStyle: ComputedStyle,
  measurer: TextMeasurer,
): MarkerBox {
  const blockId = line.ownerBlockId;
  const offset = line.inlineOffsetEnd;
  // Block-child frame: a line's own (x, y) is its coordinate here.
  const frame: AbsoluteLineBox[] = lines
    .filter((l) => l.ownerBlockId === blockId)
    .map((l) => ({ line: l, absoluteX: l.x, absoluteY: l.y, pageIndex: 0 }));
  const caret = resolvePositionInOwnLines(frame, createPosition(blockId, offset), measurer);
  const am = axisMapFor(line.writingMode, line.computedStyle.direction);
  const lineCoord = am.inline === "x" ? line.x : line.y;
  const lineSize = am.inline === "x" ? line.width : line.height;
  // The caret's physical inline coordinate → a logical inline offset in the line's
  // frame; the mark's logical inline-start is the caret, so it advances forward
  // (leftward in RTL, downward in vertical) — the factory maps it back to physical.
  const along = am.inlineReversed ? lineCoord + lineSize - caret.x : caret.x - lineCoord;
  const containingInlineSize = am.inlineReversed
    ? lineCoord + line.inlineOffset + line.inlineSize
    : line.inlineOffset + line.inlineSize;
  const style: ComputedStyle = {
    ...runStyle,
    color: mark.color ?? runStyle.color,
    underline: mark.kind.includes("split") || mark.kind.includes("insert"),
    lineThrough: mark.kind.includes("join"),
  };
  const glyph = measurer.measureWidth(PILCROW, style);
  if (mark.kind.startsWith("section")) {
    // Word's section-break label fills the rest of the line (no line space taken).
    return createMarkerBox(
      `${blockId}-end-mark`,
      line.inlineOffset + along, line.blockOffset,
      Math.max(glyph, lineSize - along), line.blockSize,
      line.writingMode, line.direction,
      style, line.usedStyle,
      SECTION_BREAK_LABEL, containingInlineSize,
      undefined, undefined,
      { blockId, offset, mark, labelInlineSize: measurer.measureWidth(SECTION_BREAK_LABEL, style) },
    );
  }
  // An inline-end float narrows this line: the ¶ is clipped at the line end (the
  // float's margin box) instead of hanging over the float.
  return createMarkerBox(
    `${blockId}-end-mark`,
    line.inlineOffset + along, line.blockOffset,
    glyph, line.blockSize,
    line.writingMode, line.direction,
    style, line.usedStyle,
    PILCROW, containingInlineSize,
    undefined, undefined,
    line.endsAtFloat === true
      ? { blockId, offset, mark, maxInlineSize: Math.max(0, lineSize - along) }
      : { blockId, offset, mark },
  );
}

const PILCROW = "¶";
/** The label of a section-end item (Word: "Section Break"); the backend owns the text. */
const SECTION_BREAK_LABEL = "Section Break";

/** The style of the line's logically last text run; the line's (block) style when it has none. */
function lastRunStyle(line: LineBox): ComputedStyle {
  const view = buildLineBidiView({ line, absoluteX: 0, absoluteY: 0, pageIndex: 0 });
  for (let i = view.logicalLeaves.length - 1; i >= 0; i--) {
    const leaf = view.logicalLeaves[i]?.leaf;
    if (leaf?.kind === "text-run") return leaf.computedStyle;
  }
  return line.computedStyle;
}
