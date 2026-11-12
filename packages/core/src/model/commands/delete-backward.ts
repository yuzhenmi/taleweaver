import type { Document } from "../document/types";
import type { Plan } from "../plan";
import { caretAt, isObjectSelection } from "../position/model-position";
import { edgeParagraphOf } from "../position/block-object";
import { type ParagraphLayout, type TerminatorRef, paragraphLayout as layoutOf } from "../position/paragraph-layout";
import { positionAtPoint } from "../position/position-at-point";
import { pointOf } from "../position/storage-points";
import { isObjectEnd } from "../position/table-extent";
import { followingOf, paragraphBefore } from "../position/terminator-neighbours";
import { holdsFlows, isAtomicBlockObject, isParagraphBreak, isRemovedByJoin } from "../scan/kinds";
import type { CommandContext } from "./command-context";
import { clearCells } from "./table/clear-cells";
import { cellsRect } from "./table/cell-rect";
import { deleteBlockObject } from "./delete-block-object";
import { containerKey, rangeOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { deleteRange, deleteSelectionOf } from "./helpers/delete-range";
import { deleteRule, deleteTerminator, deleteUnits, isRuleParagraph, unitToDelete } from "./helpers/delete-units";
import { isListItem, listExit } from "./helpers/list-exit";
import { keepParagraph } from "./helpers/writes";

/**
 * Backspace. An object selection → C10. Range → C9. Mid-paragraph: the grapheme / inline atom before the caret
 * (C4: one character, G5; zero-width anchors and floats are stepped over, C4f). At the
 * paragraph start: a list item exits the list; after an atomic block object, it goes
 * (C6); after a table (its `⟧`) C5: an empty paragraph W2 does not need goes, the caret to the end of the
 * table's last paragraph, else nothing; at a cell's start (`⟨c⟩` / `⟨r⟩` / `⟦` from inside) nothing, as at the flow start;
 * after a rule paragraph C4r; after `[S]` C7; else the C3 join.
 */
export function deleteBackward(ctx: CommandContext): Plan | null {
  const cells = cellsRect(ctx);
  if (cells !== null) return clearCells(ctx, cells); // N7: every cell cleared, the selection stays
  if (isObjectSelection(ctx.selection)) return deleteBlockObject(ctx, ctx.selection.object); // C10
  const r = rangeOf(ctx);
  if (r === null) return null;
  if (!r.collapsed) return deleteSelectionOf(ctx, r);
  const { L, offset } = r.start;
  const d = ctx.version;
  const u = unitToDelete(L, offset, -1, ctx.options ?? {});
  if (u !== null) {
    const writes = deleteUnits(L, u.from, u.to);
    const id = L.block.id;
    const back = offset - u.from;
    return writes.length === 0 ? null : plan(d, writes, () => caretAt(id, offset - back));
  }
  if (isListItem(L.block)) return listExit(ctx, L, ctx.selection);
  const before = L.before;
  if (before === null) return null; // the flow's first position
  const here = L.block.id;
  const k = before.token.k;
  if (isAtomicBlockObject(k)) {
    // C6 (an implicit paragraph keeps a ¶ of its own: the object goes, the paragraph stays).
    const keep = keepParagraph(L);
    return plan(d, [...keep.writes, ...deleteTerminator(L.fs, before)], () => caretAt(keep.id(), offset));
  }
  if (holdsFlows(k)) return isObjectEnd(before.token) ? afterTable(ctx, L) : null;
  if (isRemovedByJoin(k) && closesTable(d, L, before)) return null;
  const X = isParagraphBreak(k) ? layoutOf(d, before.token.id) : paragraphBefore(d, L.fs, before);
  if (isParagraphBreak(k) && X !== null && isRuleParagraph(X)) {
    const writes = deleteRule(d, X);
    return writes.length === 0 ? null : plan(d, writes, () => caretAt(here, offset));
  }
  if (X === null) {
    // C7 with no paragraph before the [S] (Q1's [S][S], or an object): delete only the [S].
    return isRemovedByJoin(k) ? plan(d, deleteTerminator(L.fs, before), () => caretAt(here, offset)) : null;
  }
  // C3 / C7: the join — delete ¶X (and the [S] after it); skipped markers / floats before the caret stay.
  const del = deleteRange({ L: X, offset: X.length }, { L, offset: 0 });
  if (del === null) return null;
  const shift = X.length;
  return plan(d, del.writes, () => caretAt(del.survivor(), shift + offset));
}

/**
 * C5 (Word): Backspace at the start of paragraph `Y` right after a table's `⟧`. An empty, real `Y` followed by a
 * ¶-paragraph (so W2 does not need it) goes; the caret to the end of the table's last paragraph. Else nothing.
 */
function afterTable(ctx: CommandContext, Y: ParagraphLayout): Plan | null {
  const d = ctx.version;
  if (Y.length > 0 || Y.mark === null || Y.end === null) return null;
  const next = followingOf(d, Y.fs, Y.end);
  if (next.k !== "paragraph" || next.L.mark === null) return null;
  // The table: the record before Y (its id is its `⟦`'s, untouched by this write).
  const table = Y.block.prevSiblingId;
  const sel = ctx.selection;
  return plan(d, deleteTerminator(Y.fs, Y.end), (after) => {
    const last = table === null ? null : edgeParagraphOf(after, table, -1);
    const L = last === null ? null : layoutOf(after, last);
    return L === null ? sel : caretAt(L.block.id, L.length);
  });
}

/** The `[S]` before paragraph `L` closes an (unclosed) table: what reads right before it is in a cell (no [S] is inside one). */
function closesTable(d: Document, L: ParagraphLayout, s: TerminatorRef): boolean {
  const at = pointOf(L.fs, s);
  const p = at === null ? null : positionAtPoint(d, L.fs, at.piece, at.index, -1);
  const P = p === null ? null : layoutOf(d, p.blockId);
  return P !== null && containerKey(d, P) !== containerKey(d, L);
}
