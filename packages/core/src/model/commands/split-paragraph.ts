import { BLOCK_TYPES, type Block, type BlockId } from "../block";
import type { Plan } from "../plan";
import { blockObjectAt } from "../position/block-object";
import { unitsBefore } from "../position/terminator-neighbours";
import { isParagraphBreak } from "../scan/kinds";
import { newParagraphMark } from "../storage/new-items";
import { caretAt } from "../position/model-position";
import type { CommandContext } from "./command-context";
import { clearCells } from "./table/clear-cells";
import { cellsRect } from "./table/cell-rect";
import { type Range, rangeOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { isListItem, listExit } from "./helpers/list-exit";
import { overSelection } from "./helpers/over-object";
import { splitWrites } from "./helpers/split-writes";
import { insertAt } from "./helpers/writes";

/**
 * C2 Enter. A range is deleted first (an object selection's object: the split is at the start of the paragraph after it). On an empty list item it exits the list (today).
 * Caret: the start of the tail, which keeps the paragraph's ¶ and id.
 * E2: at the very start of a table's first cell, no ¶ before the table, a default ¶ goes before the table; the caret stays.
 */
export function splitParagraph(ctx: CommandContext): Plan | null {
  const cells = cellsRect(ctx);
  if (cells !== null) return clearCells(ctx, cells, splitParagraph); // N7 (GDocs): clear, split in the first
  return overSelection(ctx, split);
}

function split(ctx: CommandContext): Plan | null {
  const r = rangeOf(ctx);
  if (r === null) return null;
  const above = aboveTable(ctx, r);
  if (above !== null) return above;
  if (r.collapsed && isListItem(r.start.L.block) && r.start.L.length === 0) return listExit(ctx, r.start.L, ctx.selection);
  const s = splitWrites(ctx, r);
  if (s === null) return null;
  return plan(ctx.version, s.writes, () => caretAt(s.tail(), 0));
}

/**
 * E2 (Word / LibreOffice): a caret at offset 0 of the first paragraph of a table's first cell, when what precedes the
 * table's `⟦` is the flow start, a cell start, `[S]` or a block object (nothing read and no ¶): a ¶ before the `⟦`.
 */
function aboveTable(ctx: CommandContext, r: Range): Plan | null {
  const { L, offset } = r.start;
  if (!r.collapsed || offset !== 0) return null;
  const tree = ctx.version.trees[L.tree];
  const get = (id: BlockId | null): Block | undefined => (id === null ? undefined : tree.get(id));
  const cell = get(L.block.parentId);
  const row = get(cell?.parentId ?? null);
  const table = get(row?.parentId ?? null);
  if (cell?.type !== BLOCK_TYPES.tableCell || row === undefined || table === undefined) return null;
  if (cell.firstChildId !== L.block.id || row.firstChildId !== cell.id || table.firstChildId !== row.id) return null;
  const at = blockObjectAt(ctx.version, table.id);
  if (at === null) return null;
  const { units, before } = unitsBefore(at.fs, at.term.seg, at.term.tok, 0);
  if (units > 0 || isParagraphBreak(before?.token.k)) return null;
  const sel = ctx.selection;
  return plan(ctx.version, [insertAt(at.point, [{ embed: newParagraphMark(), attrs: {} }])], () => sel);
}
