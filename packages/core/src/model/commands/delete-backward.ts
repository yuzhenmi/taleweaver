import type { Plan } from "../plan";
import { caretAt } from "../position/model-position";
import { paragraphLayout } from "../position/paragraph-layout";
import { paragraphBefore } from "../position/terminator-neighbours";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { deleteRange, deleteSelectionOf } from "./helpers/delete-range";
import { deleteRule, deleteTerminator, deleteUnits, isRuleParagraph, unitToDelete } from "./helpers/delete-units";
import { isListItem, listExit } from "./helpers/list-exit";

/**
 * Backspace. Range → C9. Mid-paragraph: the grapheme / embed before the caret
 * (C4 — an inline image or `[hr]` is one character, G5; floats and markers are
 * stepped over, C4f). At the paragraph start: a list item exits the list; after a
 * rule paragraph C4r; after a TOC C6; after `[S]` C7; else the C3 join.
 */
export function deleteBackward(ctx: CommandContext): Plan | null {
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
  if (before.token.k === "toc") {
    // C6: delete the TOC (today's delete-adjacent-atomic-leaf).
    return plan(d, deleteTerminator(L.fs, before), () => caretAt(here, offset));
  }
  // C5 (a table before the paragraph) arrives with tables in P2.
  const X = before.token.k === "para" ? paragraphLayout(d, before.token.id) : paragraphBefore(d, L.fs, before);
  if (before.token.k === "para" && X !== null && isRuleParagraph(X)) {
    const writes = deleteRule(d, X);
    return writes.length === 0 ? null : plan(d, writes, () => caretAt(here, offset));
  }
  if (X === null) {
    // C7 with no paragraph before the [S] (Q1's [S][S], or an object): delete only the [S].
    return before.token.k === "S" ? plan(d, deleteTerminator(L.fs, before), () => caretAt(here, offset)) : null;
  }
  // C3 / C7: the join — delete ¶X (and the [S] after it); skipped markers / floats before the caret stay.
  const del = deleteRange({ L: X, offset: X.length }, { L, offset: 0 });
  if (del === null) return null;
  const shift = X.length;
  return plan(d, del.writes, () => caretAt(del.survivor(), shift + offset));
}
