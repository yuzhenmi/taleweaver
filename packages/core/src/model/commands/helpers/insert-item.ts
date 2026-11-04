import type * as Y from "yjs";
import type { BlockId } from "../../block";
import type { InsertUnit, Plan, Write } from "../../plan";
import { caretAt } from "../../position/model-position";
import { pointAfter } from "../../position/storage-points";
import { CATEGORIES, type FlowKind, categoryOfKind } from "../../scan/kinds";
import { typeId } from "../../storage/item-id";
import { newParagraphMark } from "../../storage/new-items";
import type { CommandContext } from "../command-context";
import { rangeOf } from "./at";
import { plan } from "./build-plan";
import { deleteRange } from "./delete-range";
import { overSelection } from "./over-object";
import { diffKeys, joinKeys, keysOf } from "./paragraph-keys";
import { canPlace } from "./placement";
import { replaceSelection } from "./replace-selection";
import { insertAt, keysWrite, materialize } from "./writes";

/**
 * Insert one inline item of `kind` (made by `make`) over the selection, as its category's
 * `insertedAlone` trait says: in a paragraph of its own (C13), else in the run at the caret
 * (taking the typing attrs). A no-op where the kind is not placed.
 */
export function insertItem(ctx: CommandContext, kind: FlowKind, make: () => Y.Map<unknown>): Plan | null {
  const alone = CATEGORIES[categoryOfKind(kind)].insertedAlone;
  return overSelection(ctx, (c) => {
    const r = rangeOf(c);
    if (r === null || !canPlace(c.version, kind, r.start)) return null;
    return alone ? insertAlone(c, make) : replaceSelection(c, (attrs) => [{ embed: make(), attrs }]);
  });
}

/**
 * C13 with review-r7 G1's shape: the selection is replaced first (C9 / C10: P is then the
 * paragraph the deletion leaves — the range's end paragraph, holding the start's head
 * and the end's tail); before P's ¶ insert ¶N (P's keys: the join's), the item, ¶M —
 * `x¶N [hr]¶M ¶P` — and clear ¶P's keys, so the derived result is today's: P's text,
 * the item's paragraph, then an empty Normal paragraph with the caret at its start. Every
 * insert is at or before the flow's final ¶ (A1). Debris P gets its ¶ (X2). Applied
 * directly in suggest mode too (G2).
 */
function insertAlone(ctx: CommandContext, make: () => Y.Map<unknown>): Plan | null {
  const r = rangeOf(ctx);
  if (r === null) return null;
  const { start, end } = r;
  const L = end.L;
  const p = pointAfter(L, L.length);
  if (p === null) return null;
  const keys = start.L.block.id === L.block.id ? keysOf(L) : (joinKeys(start) ?? keysOf(L));
  const units: InsertUnit[] = [{ embed: newParagraphMark(keys), attrs: {} }, { embed: make(), attrs: {} }, { embed: newParagraphMark(), attrs: {} }];
  // The item's units first: a materialized ¶P lands at the same index, after them in plan order.
  const writes: Write[] = [];
  let caretId: () => BlockId;
  if (!r.collapsed) {
    const del = deleteRange(start, end, {});
    if (del === null) return null;
    writes.push(insertAt(p, units), ...del.writes);
    caretId = del.survivor;
  } else if (L.mark !== null) {
    writes.push(insertAt(p, units), ...keysWrite(L.mark, diffKeys(keysOf(L), {})));
    const id = L.block.id;
    caretId = () => id;
  } else {
    const m = materialize(L, {}, units);
    if (m === null) return null;
    writes.push(...m.writes);
    const fallback = L.block.id;
    caretId = () => typeId(m.map) ?? fallback;
  }
  return plan(ctx.version, writes, () => caretAt(caretId(), 0));
}
