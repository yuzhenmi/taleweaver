import type { Plan } from "../plan";
import { caretAt, isObjectSelection } from "../position/model-position";
import type { ParagraphLayout } from "../position/paragraph-layout";
import { followingOf } from "../position/terminator-neighbours";
import { holdsFlows, isAtomicBlockObject, isRemovedByJoin } from "../scan/kinds";
import type { CommandContext } from "./command-context";
import { deleteBlockObject } from "./delete-block-object";
import { rangeOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { deleteRange, deleteSelectionOf } from "./helpers/delete-range";
import { deleteRule, deleteTerminator, deleteUnits, isRuleParagraph, unitToDelete } from "./helpers/delete-units";

/**
 * Delete (forward): the mirror of Backspace (C8). At the end of a paragraph: the next
 * rule paragraph goes (C4r), an atomic block object goes (C6), `[S]` is joined across
 * — except when a block object or another `[S]` follows the `[S]` (the C8 correction):
 * then only the `[S]` goes. At the flow's final ¶: nothing. Next to a block object
 * holding flows: nothing (its C5 mirror arrives with table editing, P2 M3).
 */
export function deleteForward(ctx: CommandContext): Plan | null {
  if (isObjectSelection(ctx.selection)) return deleteBlockObject(ctx, ctx.selection.object); // C10
  const r = rangeOf(ctx);
  if (r === null) return null;
  if (!r.collapsed) return deleteSelectionOf(ctx, r);
  const { L, offset } = r.start;
  const d = ctx.version;
  const u = unitToDelete(L, offset, 1, ctx.options ?? {});
  const here = L.block.id;
  if (u !== null) {
    const writes = deleteUnits(L, u.from, u.to);
    return writes.length === 0 ? null : plan(d, writes, () => caretAt(here, offset));
  }
  const end = L.end;
  if (end === null || holdsFlows(end.token.k)) return null;
  if (L.mark === null) return plan(d, deleteTerminator(L.fs, end), () => caretAt(here, offset)); // debris: the object / [S] after it
  const next = followingOf(d, L.fs, end);
  let N: ParagraphLayout;
  if (next.k === "end") return null;
  if (next.k === "terminator") {
    const k = next.term.token.k;
    if (isAtomicBlockObject(k)) return plan(d, deleteTerminator(L.fs, next.term), () => caretAt(here, offset));
    if (!isRemovedByJoin(k)) return null;
    const after = followingOf(d, L.fs, next.term);
    if (after.k !== "paragraph") return plan(d, deleteTerminator(L.fs, next.term), () => caretAt(here, offset));
    N = after.L;
  } else {
    N = next.L;
    if (isRuleParagraph(N)) {
      const writes = deleteRule(d, N);
      return writes.length === 0 ? null : plan(d, writes, () => caretAt(here, offset));
    }
  }
  const del = deleteRange({ L, offset: L.length }, { L: N, offset: 0 });
  if (del === null) return null;
  return plan(d, del.writes, () => caretAt(del.survivor(), offset));
}
