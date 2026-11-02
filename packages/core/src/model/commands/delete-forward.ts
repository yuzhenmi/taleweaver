import type { Plan } from "../plan";
import { caretAt } from "../position/model-position";
import type { ParagraphLayout } from "../position/paragraph-layout";
import { followingOf } from "../position/terminator-neighbours";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { deleteRange, deleteSelectionOf } from "./helpers/delete-range";
import { deleteRule, deleteTerminator, deleteUnits, isRuleParagraph, unitToDelete } from "./helpers/delete-units";

/**
 * Delete (forward): the mirror of Backspace (C8). At the end of a paragraph: the
 * next rule paragraph goes (C4r), a TOC goes (C6), `[S]` is joined across — except
 * when a block object or another `[S]` follows the `[S]` (the C8 correction): then
 * only the `[S]` goes. At the flow's final ¶: nothing.
 */
export function deleteForward(ctx: CommandContext): Plan | null {
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
  if (end === null) return null;
  if (end.token.k !== "para") return plan(d, deleteTerminator(L.fs, end), () => caretAt(here, offset)); // debris: the object / [S] after it
  const next = followingOf(d, L.fs, end);
  if (next.k === "end") return null;
  if (next.k === "toc") return plan(d, deleteTerminator(L.fs, next.term), () => caretAt(here, offset));
  let N: ParagraphLayout;
  if (next.k === "S") {
    const after = followingOf(d, L.fs, next.term);
    if (after.k !== "para") return plan(d, deleteTerminator(L.fs, next.term), () => caretAt(here, offset));
    N = after.L;
  } else if (next.k === "para") {
    N = next.L;
    if (isRuleParagraph(N)) {
      const writes = deleteRule(d, N);
      return writes.length === 0 ? null : plan(d, writes, () => caretAt(here, offset));
    }
  } else return null;
  const del = deleteRange({ L, offset: L.length }, { L: N, offset: 0 });
  if (del === null) return null;
  return plan(d, del.writes, () => caretAt(del.survivor(), offset));
}
