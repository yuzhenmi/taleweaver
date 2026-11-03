import type { Block, BlockId } from "../block";
import { peekBlock } from "../document/blocks";
import type { Plan } from "../plan";
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
      const get = (id: BlockId | null | undefined): Block | undefined => (id === null || id === undefined ? undefined : peekBlock(after, id));
      const table = get(isTextSelection(s) ? get(s.focus.blockId)?.prevSiblingId : null);
      const first = get(get(get(table?.firstChildId)?.firstChildId)?.firstChildId);
      return table?.inlineContent !== null || first === undefined ? s : caretAt(first.id, 0);
    },
  };
}
