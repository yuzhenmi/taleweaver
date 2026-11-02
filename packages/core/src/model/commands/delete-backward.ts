import type { Plan } from "../plan";
import { caretAt, isObjectSelection } from "../position/model-position";
import { paragraphLayout } from "../position/paragraph-layout";
import { paragraphBefore } from "../position/terminator-neighbours";
import { isAtomicBlockObject, isBlockObject, isParagraphBreak, isRemovedByJoin } from "../scan/kinds";
import type { CommandContext } from "./command-context";
import { deleteBlockObject } from "./delete-block-object";
import { rangeOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { deleteRange, deleteSelectionOf } from "./helpers/delete-range";
import { deleteRule, deleteTerminator, deleteUnits, isRuleParagraph, unitToDelete } from "./helpers/delete-units";
import { isListItem, listExit } from "./helpers/list-exit";
import { keepParagraph } from "./helpers/writes";

/**
 * Backspace. An object selection → C10. Range → C9. Mid-paragraph: the grapheme / inline atom before the caret
 * (C4: one character, G5; zero-width anchors and floats are stepped over, C4f). At the
 * paragraph start: a list item exits the list; after an atomic block object, it goes
 * (C6); after a block object holding flows, nothing (C5, with table editing, P2 M3);
 * after a rule paragraph C4r; after `[S]` C7; else the C3 join.
 */
export function deleteBackward(ctx: CommandContext): Plan | null {
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
  if (isBlockObject(k)) return null; // C5 arrives with table editing, P2 M3.
  const X = isParagraphBreak(k) ? paragraphLayout(d, before.token.id) : paragraphBefore(d, L.fs, before);
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
