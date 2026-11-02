import type { BlockId } from "../block";
import type { InsertUnit, Plan, Write } from "../plan";
import { caretAt } from "../position/model-position";
import type { StoragePoint } from "../position/paragraph-layout";
import { comparePoints, pointAfter } from "../position/storage-points";
import { typeId } from "../storage/item-id";
import { newParagraphMark } from "../storage/new-items";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { deleteRange } from "./helpers/delete-range";
import { type FragmentItem, isBlockItem, units } from "./helpers/fragment";
import { inMainTree } from "./helpers/in-main-tree";
import { replaceSelection } from "./helpers/replace-selection";
import { splitWrites } from "./helpers/split-writes";
import { insertAt, materialize } from "./helpers/writes";

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
  const r = rangeOf(ctx);
  if (r === null) return null;
  const needsMain = fragment.some((i) => isBlockItem(i) || i.k === "footnote");
  if (needsMain && !inMainTree(r.start)) return null;
  const us = units(ctx, fragment, false);
  const structural = fragment.some((i) => i.k === "para" || isBlockItem(i));
  // Read units after the payload's last ¶ / block object: the caret's offset in the tail.
  let lastLen = 0;
  for (const i of fragment) {
    if (i.k === "para" || isBlockItem(i)) lastLen = 0;
    else lastLen += i.k === "text" ? i.text.length : 1;
  }
  if (!structural) return replaceSelection(ctx, () => us);
  const first = fragment[0];
  const startsWithBlock = first !== undefined && isBlockItem(first);
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
  // What precedes the insertion point: the paragraph's previous terminator, or the flow start when the range took leading objects.
  const before = ins === p ? start.L.before?.token.k : undefined;
  const lead: InsertUnit[] = [];
  if (startsWithBlock && start.offset === 0 && (before === "toc" || (first?.k === "S" && before !== "para"))) lead.push({ embed: newParagraphMark(), attrs: {} });
  writes.push(insertAt(ins, [...lead, ...us]));
  return plan(ctx.version, writes, () => caretAt(tail(), lastLen));
}
