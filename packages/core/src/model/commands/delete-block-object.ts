import { BLOCK_TYPES, type BlockId } from "../block";
import { resolveBlock } from "../document/blocks";
import type { Plan } from "../plan";
import { caretAt } from "../position/model-position";
import { terminatorOf } from "../position/paragraph-layout";
import { positionAtPoint } from "../position/position-at-point";
import type { CommandContext } from "./command-context";
import { plan } from "./helpers/build-plan";

/** C10: delete block object `id` (a TOC): just its item. Caret: the position where it was. */
export function deleteBlockObject(ctx: CommandContext, id: BlockId): Plan | null {
  const d = ctx.version;
  const b = resolveBlock(d, id);
  const fs = d.flows.get(d.rootId);
  if (b === null || b.block.type !== BLOCK_TYPES.tableOfContents || fs === undefined) return null;
  // Its own terminator, whatever follows it ([T][U]¶ and [T][S] included).
  const t = terminatorOf(d, fs, id);
  const seg = t === null ? undefined : fs.segments[t.seg];
  if (t === null || seg === undefined || t.token.k !== "toc") return null;
  const piece = seg.piece;
  const index = t.index;
  const sel = ctx.selection;
  return plan(d, [{ k: "delete", piece, index, len: 1 }], (after) => {
    // The caret: whatever now sits where the TOC was.
    const afs = after.flows.get(after.rootId);
    const p = afs === undefined ? null : positionAtPoint(after, afs, piece, index, 1);
    return p === null ? sel : caretAt(p.blockId, p.offset);
  });
}
