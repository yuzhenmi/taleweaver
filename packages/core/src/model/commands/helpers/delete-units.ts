import { EMBED_TYPES, type InlineItem } from "../../block";
import type { Document, FlowState } from "../../document/types";
import type { Write } from "../../plan";
import { graphemeStepAt } from "../../position/graphemes";
import { isFloat, itemAt, itemBefore, nextItem, prevItem } from "../../position/items";
import type { ParagraphLayout, StoragePoint } from "../../position/paragraph-layout";
import { atomicUnitAround } from "../../position/resolve-position";
import { pointAfter, pointBefore } from "../../position/storage-points";
import { followingOf } from "../../position/terminator-neighbours";
import type { CommandOptions } from "../command-context";
import { deleteBetween } from "./writes";

// ---------------------------------------------------------------------------
// Backspace / Delete (C3, C4, C4f, C4r, C6, C7, C8, C9)
// ---------------------------------------------------------------------------

/** A rule paragraph: a ¶ paragraph whose only content is one `[hr]`. */
export function isRuleParagraph(L: ParagraphLayout): boolean {
  const items = L.block.inlineContent?.items ?? [];
  const only = items[0];
  return L.mark !== null && items.length === 1 && only !== undefined && only.kind === "embed" && only.embedType === EMBED_TYPES.horizontalLine;
}

/** Caret steps skip these: markers (no caret stop) and floats (C4f). */
const skippable = (i: InlineItem | undefined): boolean => i !== undefined && i.kind === "embed" && (i.embedType === EMBED_TYPES.marker || isFloat(i));

/** The unit Backspace (dir −1) / Delete (+1) at `offset` removes: a grapheme of the text item, or one embed; atomic marks widen it (R14). Null when only skippables remain. Walks items outward from `offset` only. */
export function unitToDelete(L: ParagraphLayout, offset: number, dir: -1 | 1, opts: CommandOptions): { from: number; to: number } | null {
  let ref = dir < 0 ? itemBefore(L, offset) : itemAt(L, offset);
  let o = offset;
  while (ref !== null && skippable(ref.item)) {
    o = dir < 0 ? ref.start : ref.start + 1;
    ref = dir < 0 ? prevItem(L, ref) : nextItem(L, ref);
  }
  if (ref === null) return null;
  let from: number;
  let to: number;
  if (ref.item.kind === "text") {
    if (dir < 0) {
      to = o;
      from = graphemeStepAt(L, o, -1);
    } else {
      from = o;
      to = graphemeStepAt(L, o, 1);
    }
  } else {
    from = ref.start;
    to = ref.start + 1;
  }
  const isAtomic = opts.isAtomicMark;
  if (isAtomic !== undefined) {
    from = atomicUnitAround(L, from, isAtomic)?.start ?? from;
    to = atomicUnitAround(L, to, isAtomic)?.end ?? to;
  }
  return { from, to };
}

/** Delete storage of read units `[from, to)` of one paragraph. */
export function deleteUnits(L: ParagraphLayout, from: number, to: number): Write[] {
  const a = pointBefore(L, from);
  const b = pointAfter(L, to);
  return a === null || b === null ? [] : deleteBetween(L.fs, a, b);
}

/** C4r: delete rule paragraph R (`[hr]` and ¶M), or only its `[hr]` when ¶M must stay (W2 / before `[S]` / the flow's final ¶). */
export function deleteRule(d: Document, R: ParagraphLayout): Write[] {
  if (R.end === null) return [];
  const before = R.before?.token.k;
  const next = followingOf(d, R.fs, R.end).k;
  // ¶M stays only where removing it would leave nothing after: before [S], at the flow end, or a TOC left without a paragraph.
  const keepMark = next === "S" || next === "end" || (before === "toc" && next !== "para");
  const a = pointBefore(R, 0);
  const seg = R.fs.segments[R.end.seg];
  if (a === null || seg === undefined) return [];
  const b: StoragePoint = keepMark ? { piece: seg.piece, index: R.end.index, seg: R.end.seg } : { piece: seg.piece, index: R.end.index + 1, seg: R.end.seg };
  return deleteBetween(R.fs, a, b);
}

export const deleteTerminator = (fs: FlowState, t: { seg: number; index: number }): Write[] => {
  const seg = fs.segments[t.seg];
  return seg === undefined ? [] : [{ k: "delete", piece: seg.piece, index: t.index, len: 1 }];
};
