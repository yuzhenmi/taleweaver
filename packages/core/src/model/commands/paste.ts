import type { BlockId } from "../block";
import type { InsertUnit, Plan, Write } from "../plan";
import { caretAt, isObjectSelection } from "../position/model-position";
import type { StoragePoint, TerminatorRef } from "../position/paragraph-layout";
import { comparePoints, pointAfter } from "../position/storage-points";
import { unitsBefore } from "../position/terminator-neighbours";
import { isBlockObject, isParagraphBreak, isSectionBreak, isStructural } from "../scan/kinds";
import { typeId } from "../storage/item-id";
import { newParagraphMark } from "../storage/new-items";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { deleteRange } from "./helpers/delete-range";
import { type FragmentItem, fragmentUnits, placeable, units } from "./helpers/fragment";
import { overObject, withWrite } from "./helpers/over-object";
import { containerOf } from "./helpers/placement";
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
  if (!isObjectSelection(ctx.selection)) return pasteAt(ctx, fragment, null);
  const o = overObject(ctx);
  return o === null ? null : withWrite(o.write, pasteAt(o.ctx, fragment, o.object));
}

/** Paste at `ctx`'s selection; `replaced`: the block object an object selection deleted, just before the caret's paragraph (or before the block objects abutting it). */
function pasteAt(ctx: CommandContext, fragment: readonly FragmentItem[], replaced: TerminatorRef | null): Plan | null {
  const r = rangeOf(ctx);
  if (r === null) return null;
  // Placement: a payload holding a kind the target container does not take (a footnote body's included) is not pasted (as today).
  if (!placeable(fragment, containerOf(r.start))) return null;
  const us = units(ctx, fragment);
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
  // precedes it ("run": text); undefined: the flow start (a select-all took everything before the paragraph).
  const prev = start.L.before;
  const prior = replaced !== null && prev !== null && prev.token.id === replaced.token.id ? unitsBefore(start.L.fs, replaced.seg, replaced.tok, 0) : null;
  const before = comparePoints(ins, p) < 0 ? undefined : prior === null ? prev?.token.k : prior.units > 0 ? "run" : prior.before?.token.k;
  const lead: InsertUnit[] = [];
  if (startsWithBlock && start.offset === 0 && (isBlockObject(before) || (isSectionBreak(first?.k) && !isParagraphBreak(before)))) lead.push({ embed: newParagraphMark(), attrs: {} });
  writes.push(insertAt(ins, [...lead, ...us]));
  return plan(ctx.version, writes, () => caretAt(tail(), lastLen));
}
