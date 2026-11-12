import { resolveBlock } from "../document/blocks";
import { isCellSelection, isObjectSelection } from "../position/model-position";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import type { FragmentItem } from "./helpers/fragment";
import { readCells } from "./helpers/read-cells";
import { blockObjectOf, readSlice } from "./helpers/read-slice";
import { cellsRect } from "./table/cell-rect";

/**
 * Copy: the selection as a fragment, the inverse of paste (pasting `copy(sel)` over `sel` reads the same, modulo
 * anchors). Null for a caret or a range holding nothing that reads (an empty paragraph). An object selection copies its
 * block object (a table, a TOC); a cell selection (or a text selection across cells) one table item of its rectangle.
 */
export function copy(ctx: CommandContext): FragmentItem[] | null {
  const sel = ctx.selection;
  if (isObjectSelection(sel)) {
    const b = resolveBlock(ctx.version, sel.object)?.block;
    const o = b === undefined ? null : blockObjectOf(ctx.version, b);
    return o === null ? null : [o];
  }
  const rect = cellsRect(ctx);
  if (rect !== null) {
    const t = readCells(rect);
    return t === null ? null : [t];
  }
  if (isCellSelection(sel)) return null;
  const r = rangeOf(ctx);
  const items = r === null || r.collapsed ? null : readSlice(ctx.version, r);
  return items === null || items.length === 0 ? null : items;
}
