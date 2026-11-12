import type { BlockId } from "../block";
import type { InsertUnit, Plan, Write } from "../plan";
import { caretAt, isObjectSelection } from "../position/model-position";
import type { BlockObject } from "../position/block-object";
import type { StoragePoint } from "../position/paragraph-layout";
import { comparePoints, pointAfter } from "../position/storage-points";
import { isObjectEnd } from "../position/table-extent";
import { unitsBefore } from "../position/terminator-neighbours";
import { holdsFlows, isParagraphBreak, isSectionBreak, isStructural } from "../scan/kinds";
import { typeId } from "../storage/item-id";
import { newParagraphMark } from "../storage/new-items";
import type { CommandContext } from "./command-context";
import { clearCells } from "./table/clear-cells";
import { cellsRect } from "./table/cell-rect";
import { rangeOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { deleteRange } from "./helpers/delete-range";
import { type FragmentItem, fragmentUnits, placeable, units } from "./helpers/fragment";
import { overObject, withWrites } from "./helpers/over-object";
import { containerOf, tableDepthOf } from "./helpers/placement";
import { tablesFit } from "./helpers/fragment-table";
import { replaceSelection } from "./helpers/replace-selection";
import { splitWrites } from "./helpers/split-writes";
import { idAfter, insertAt, materialize } from "./helpers/writes";

/**
 * C17 with review-r7 G6. A payload with no ¶ and no block object is typed (C1).
 * Otherwise it goes in at the caret (a range is deleted first): the first pasted
 * paragraph's text continues the head paragraph, which then carries the pasted ¶'s
 * keys (Word); the payload's last paragraph joins the tail, whose ¶ survives. Only a
 * payload that STARTS with a block object / `[S]` splits at k > 0 (C14's placement);
 * at k = 0 it gets ¶M first when the item before is a block object (or, for `[S]`,
 * not a ¶). Caret: after the pasted content.
 */
export function paste(ctx: CommandContext, fragment: readonly FragmentItem[]): Plan | null {
  if (fragment.length === 0) return null;
  const cells = cellsRect(ctx);
  // N7 (GDocs): non-table content clears the cells, then goes into the first; table cells over cells are step 5.
  if (cells !== null) return fragment.some((i) => holdsFlows(i.k)) ? null : clearCells(ctx, cells, (c) => paste(c, fragment));
  if (!isObjectSelection(ctx.selection)) return pasteAt(ctx, fragment, null);
  const o = overObject(ctx);
  return o === null ? null : withWrites(o.writes, pasteAt(o.ctx, fragment, o.object));
}

/** Paste at `ctx`'s selection; `replaced`: the block object an object selection deleted, just before the caret's paragraph. */
function pasteAt(ctx: CommandContext, fragment: readonly FragmentItem[], replaced: BlockObject | null): Plan | null {
  const r = rangeOf(ctx);
  if (r === null) return null;
  // Placement: a payload holding a kind the target container does not take (a footnote body's included) is not pasted (as today).
  // A table is not placed past the nesting cap (its marks would be inert).
  const depth = tableDepthOf(ctx.version, r.start);
  if (!placeable(fragment, containerOf(ctx.version, r.start)) || !tablesFit(fragment, depth)) return null;
  const us = units(ctx, fragment, depth);
  const breaks = (i: FragmentItem): boolean => isParagraphBreak(i.k) || isStructural(i.k);
  const structural = fragment.some(breaks);
  // Read units after the payload's last ¶ / block object: the caret's offset in the tail.
  let lastLen = 0;
  for (const i of fragment) lastLen = breaks(i) ? 0 : lastLen + fragmentUnits(i);
  if (!structural) return replaceSelection(ctx, () => us);
  const first = fragment[0];
  const startsWithBlock = first !== undefined && isStructural(first.k);
  if (startsWithBlock && r.start.offset > 0) {
    const s = splitWrites(ctx, r, us);
    if (s === null) return null;
    return plan(ctx.version, s.writes, () => caretAt(s.tail(), lastLen));
  }
  const { start } = r;
  const p = pointAfter(start.L, start.offset);
  if (p === null || start.L.fs.synthetic) {
    // R17 (an empty holder): the payload goes in with a ¶ of its own (X2), which its last paragraph joins.
    const m = materialize(start.L, {}, us);
    if (m === null) return null;
    return plan(ctx.version, m.writes, () => {
      const pid = typeId(m.map);
      return pid === null ? ctx.selection : caretAt(pid, lastLen);
    });
  }
  const writes: Write[] = [];
  let tail: () => BlockId = () => start.L.block.id;
  let ins: StoragePoint = p;
  if (!r.collapsed) {
    // A range is deleted first (C9, with its join), then the payload goes in at the collapse point.
    const del = deleteRange(r.start, r.end);
    if (del === null) return null;
    writes.push(...del.writes);
    tail = del.survivor;
    if (comparePoints(del.at, p) < 0) ins = del.at;
  }
  // What precedes the insertion point: the paragraph's previous terminator — or, when that is the replaced object, what
  // precedes it (null: text); undefined: the flow start (a select-all took everything before the paragraph). A table
  // mark faces as a block object only as a `⟧` (a cell start is a container start, as the flow start).
  const prev = start.L.before;
  const prior = replaced !== null && prev !== null && prev.token.id === replaced.last?.token.id ? unitsBefore(start.L.fs, replaced.term.seg, replaced.term.tok, 0) : null;
  const before = comparePoints(ins, p) < 0 ? undefined : prior === null ? prev?.token : prior.units > 0 ? null : prior.before?.token;
  const objectBefore = before !== undefined && before !== null && isObjectEnd(before);
  const paraBefore = before !== undefined && before !== null && isParagraphBreak(before.k);
  const lead: InsertUnit[] = [];
  if (startsWithBlock && start.offset === 0 && (objectBefore || (isSectionBreak(first?.k) && !paraBefore))) lead.push({ embed: newParagraphMark(), attrs: {} });
  if (r.collapsed && start.L.implicit) {
    // Separate from the R17 branch above: an implicit paragraph follows a block object, so it needs `lead`, which that branch returns before computing.
    // The payload goes in with the paragraph's ¶ (X5), which its last paragraph joins.
    const m = materialize(start.L, {}, [...lead, ...us]);
    if (m === null) return null;
    return plan(ctx.version, m.writes, () => caretAt(idAfter(m.map, start.L.block.id), lastLen));
  }
  writes.push(insertAt(ins, [...lead, ...us]));
  return plan(ctx.version, writes, () => caretAt(tail(), lastLen));
}
