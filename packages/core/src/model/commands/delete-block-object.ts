import type { BlockId } from "../block";
import type { Plan } from "../plan";
import { blockObjectAt } from "../position/block-object";
import { caretAt } from "../position/model-position";
import { positionAtPoint, terminatorAtPoint } from "../position/position-at-point";
import type { CommandContext } from "./command-context";
import { plan } from "./helpers/build-plan";
import { deleteBetween, insertAt } from "./helpers/writes";
import { unitsBefore } from "../position/terminator-neighbours";
import { isSectionBreak } from "../scan/kinds";
import { newParagraphMark } from "../storage/new-items";

/**
 * C10: delete block object `id` (any block category): just its item (a table: its whole bracket), whatever follows it
 * ([T][U]¶ and [T][S] included). An unclosed table (concurrency only) runs up to the `[S]` that closes it: when nothing
 * but the flow start or a `[S]` precedes it, a ¶ takes its place, so that `[S]` keeps a paragraph before it (A2). Caret:
 * the position where it was.
 */
export function deleteBlockObject(ctx: CommandContext, id: BlockId): Plan | null {
  const d = ctx.version;
  const o = blockObjectAt(d, id);
  if (o === null) return null;
  const { piece, index } = o.point;
  const sel = ctx.selection;
  const writes = deleteBetween(o.fs, o.point, o.end);
  const closer = o.last === null ? terminatorAtPoint(o.fs, o.end.piece, o.end.index) : null;
  if (closer !== null && isSectionBreak(closer.token.k)) {
    const prev = unitsBefore(o.fs, o.term.seg, o.term.tok, 0);
    if (prev.units === 0 && (prev.before === null || isSectionBreak(prev.before.token.k))) writes.push(insertAt(o.point, [{ embed: newParagraphMark(), attrs: {} }]));
  }
  return plan(d, writes, (after) => {
    // The caret: whatever now sits where the object was.
    const afs = after.flows.get(o.fs.holderId);
    const p = afs === undefined ? null : positionAtPoint(after, afs, piece, index, 1);
    return p === null ? sel : caretAt(p.blockId, p.offset);
  });
}
