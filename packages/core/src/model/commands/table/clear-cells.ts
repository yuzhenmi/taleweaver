/** Delete / type over a cell selection (N7 step 4, GDocs / Word / PM): every cell of its rectangle cleared. */
import type { BlockId } from "../../block";
import { emptyCellParagraphId, virtualCellId } from "../../ids";
import type { Plan } from "../../plan";
import { type ModelSelection, caretAt, isAllSelection, isTextSelection } from "../../position/model-position";
import { paragraphLayout } from "../../position/paragraph-layout";
import type { CommandContext } from "../command-context";
import { rangeOf } from "../helpers/at";
import { deleteSelectionOf } from "../helpers/delete-range";
import type { CellRect } from "./cell-rect";
import { leadRange, overCells } from "./over-cells";
import { nextMarkId, slotsOf } from "./table-at";

/** A select-all delete of one cell (`ctx`'s selection: the cell's, or a virtual lead cell's range). */
function clear(ctx: CommandContext): Plan | null {
  const r = rangeOf(ctx);
  return r === null || r.collapsed ? null : deleteSelectionOf(ctx, r);
}

/**
 * Every cell of `rect` cleared to one empty paragraph, as one plan; the selection maps (stays). With `act` (typing,
 * Enter, a paste): the top-left cell's content is replaced by `act` run over it instead, and the caret is `act`'s.
 */
export function clearCells(ctx: CommandContext, rect: CellRect, act?: (ctx: CommandContext) => Plan | null): Plan | null {
  if (act === undefined) return overCells(ctx, rect, clear);
  const first = topLeft(ctx, rect);
  const main = first === null ? null : act({ ...ctx, selection: first });
  if (first === null || main === null) return null;
  const isFirst = (s: ModelSelection): boolean =>
    isAllSelection(s) ? isAllSelection(first) && s.container === first.container : isTextSelection(s) && isTextSelection(first) && s.anchor.blockId === first.anchor.blockId;
  const rest = overCells(ctx, rect, (c) => (isFirst(c.selection) ? null : clear(c)));
  return { ...main, writes: [...(rest?.writes ?? []), ...main.writes] };
}

/** The whole of the rectangle's top-left cell: a real cell's select-all; a virtual one's caret (its lead range, F2). */
function topLeft(ctx: CommandContext, rect: CellRect): ModelSelection | null {
  const { c, box } = rect;
  const row = c.form.rows[box.r0];
  if (row === undefined) return null;
  const real: BlockId | undefined = slotsOf(row)[box.c0];
  if (real !== undefined) return { kind: "all", container: real };
  const id = virtualCellId(nextMarkId(c.form, c.tableId, box.r0), box.c0);
  const empty = emptyCellParagraphId(id);
  return paragraphLayout(ctx.version, empty) !== null ? caretAt(empty, 0) : leadRange(ctx.version, id);
}
