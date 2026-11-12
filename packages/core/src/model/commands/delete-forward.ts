import type { Plan } from "../plan";
import { caretAt, isObjectSelection } from "../position/model-position";
import type { ParagraphLayout } from "../position/paragraph-layout";
import { type Following, followingOf } from "../position/terminator-neighbours";
import { holdsFlows, isAtomicBlockObject, isRemovedByJoin } from "../scan/kinds";
import { roleOf } from "../scan/tokens";
import { edgeParagraphOf } from "../position/block-object";
import { isObjectEnd } from "../position/table-extent";
import type { CommandContext } from "./command-context";
import { deleteBlockObject } from "./delete-block-object";
import { containerKey, rangeOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { deleteRange, deleteSelectionOf } from "./helpers/delete-range";
import { deleteRule, deleteTerminator, deleteUnits, isRuleParagraph, unitToDelete } from "./helpers/delete-units";
import { keepParagraph } from "./helpers/writes";

/**
 * Delete (forward): the mirror of Backspace (C8). At the end of a paragraph: the next
 * rule paragraph goes (C4r), an atomic block object goes (C6), `[S]` is joined across
 * — except when a block object or another `[S]` follows the `[S]` (the C8 correction):
 * then only the `[S]` goes. At the flow's final ¶: nothing. Before a table's `⟦` (C5's mirror): an empty, real
 * paragraph that does not follow a block object (W2's) goes, the caret to the table's first paragraph; else
 * nothing. At a cell's end (`⟨c⟩` / `⟨r⟩` / `⟧` from inside) nothing, as at the flow's end; a mark is never deleted.
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
  // A virtual end cell's end is its cell's end (an unclosed table's last row: the [S] closing the table follows).
  if (end === null || L.virtualCell !== undefined || holdsFlows(end.token.k)) return null;
  // No [S] is inside a table: one after a cell's content closes the (unclosed) table, at the cell's end.
  // An unclosed table's `/after` (its `before` the `⟦`) sits at that [S] too: as after a closed table, nothing joins.
  const closesTable = containerKey(d, L) !== "" || (L.implicit && L.before !== null && roleOf(L.before.token) === "open");
  if (closesTable && isRemovedByJoin(end.token.k)) return null;
  if (L.mark === null && !L.implicit) return plan(d, deleteTerminator(L.fs, end), () => caretAt(here, offset)); // debris: the object / [S] after it
  // An implicit paragraph has no ¶: its object / [S] follows it directly.
  const next: Following = L.implicit ? { k: "terminator", term: end } : followingOf(d, L.fs, end);
  let N: ParagraphLayout;
  if (next.k === "end") return null;
  if (next.k === "terminator") {
    const k = next.term.token.k;
    // Only the terminator goes: the caret's paragraph stays (an implicit one with a ¶ of its own).
    const only = (): Plan | null => {
      const keep = keepParagraph(L);
      return plan(d, [...keep.writes, ...deleteTerminator(L.fs, next.term)], () => caretAt(keep.id(), offset));
    };
    if (isAtomicBlockObject(k)) return only();
    if (holdsFlows(k)) return roleOf(next.term.token) === "open" ? beforeTable(ctx, L, next.term.token.id) : null;
    if (!isRemovedByJoin(k) || closesTable) return null;
    const after = followingOf(d, L.fs, next.term);
    if (after.k !== "paragraph") return only();
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

/** C8's C5 mirror: Delete at the end of paragraph `X` right before the `⟦` of table `table` (its id). */
function beforeTable(ctx: CommandContext, X: ParagraphLayout, table: string): Plan | null {
  const d = ctx.version;
  // After a block object X is W2's paragraph; an implicit X has no ¶ to delete.
  if (X.length > 0 || X.mark === null || X.end === null || (X.before !== null && isObjectEnd(X.before.token))) return null;
  const sel = ctx.selection;
  return plan(d, deleteTerminator(X.fs, X.end), (after) => {
    const first = edgeParagraphOf(after, table, 1);
    return first === null ? sel : caretAt(first, 0);
  });
}
