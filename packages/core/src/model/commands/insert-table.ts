import { peekBlock } from "../document/blocks";
import type { Plan } from "../plan";
import { edgeParagraphOf } from "../position/block-object";
import { caretAt, isTextSelection } from "../position/model-position";
import type { CommandContext } from "./command-context";
import { checkTableSize } from "./helpers/fragment";
import { paste } from "./paste";

/**
 * C14: insert a `rows` × `cols` table of empty cells over the selection: a payload of one
 * block object, so paste's C14 placement (as `insertTableOfContents`). Caret: the first
 * cell (Word / GDocs). Throws unless both are integers ≥ 1; a no-op at the nesting cap.
 */
export function insertTable(ctx: CommandContext, rows: number, cols: number): Plan | null {
  checkTableSize(rows, cols); // before the depth-cap no-op: bad counts always throw
  const p = paste(ctx, [{ k: "table", rows, cols }]);
  if (p === null) return null;
  return {
    ...p,
    selection: (after) => {
      // Paste's contract: the caret is at the start of the paragraph right after the table.
      const s = p.selection(after);
      const table = isTextSelection(s) ? peekBlock(after, s.focus.blockId)?.prevSiblingId : null;
      const first = table === null || table === undefined ? null : edgeParagraphOf(after, table, 1);
      return first === null ? s : caretAt(first, 0);
    },
  };
}
