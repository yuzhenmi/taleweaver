import type { BlockId } from "../block";
import type { Plan } from "../plan";
import { blockObjectAt } from "../position/block-object";
import { caretAt } from "../position/model-position";
import { positionAtPoint } from "../position/position-at-point";
import type { CommandContext } from "./command-context";
import { plan } from "./helpers/build-plan";
import { deleteBetween } from "./helpers/writes";

/** C10: delete block object `id` (any block category): just its item (a table: its whole bracket), whatever follows it ([T][U]¶ and [T][S] included). Caret: the position where it was. */
export function deleteBlockObject(ctx: CommandContext, id: BlockId): Plan | null {
  const d = ctx.version;
  const o = blockObjectAt(d, id);
  if (o === null) return null;
  const { piece, index } = o.point;
  const sel = ctx.selection;
  return plan(d, deleteBetween(o.fs, o.point, o.end), (after) => {
    // The caret: whatever now sits where the object was.
    const afs = after.flows.get(o.fs.holderId);
    const p = afs === undefined ? null : positionAtPoint(after, afs, piece, index, 1);
    return p === null ? sel : caretAt(p.blockId, p.offset);
  });
}
