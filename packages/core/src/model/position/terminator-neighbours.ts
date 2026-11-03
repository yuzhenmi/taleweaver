import type { Document, FlowState } from "../document/types";
import { afterObjectId, debrisBeforeId, flowEndId } from "../ids";
import { isBlockObject, isParagraphBreak } from "../scan/kinds";
import { roleOf } from "../scan/tokens";
import { afterObject, tableExtent } from "./table-extent";
import { type ParagraphLayout, type TerminatorRef, nextTerminator, paragraphLayout, readLength, runsBefore } from "./paragraph-layout";

/** Read units from the previous terminator up to (seg, tok, within). */
export function unitsBefore(fs: FlowState, seg: number, tok: number, within: number): { units: number; before: TerminatorRef | null } {
  const { runs, before } = runsBefore(fs, seg, tok);
  let units = within;
  for (const r of runs) {
    const token = fs.segments[r.seg]?.tokens[r.tok];
    if (token !== undefined && token.k === "run") units += readLength(token);
  }
  return { units, before };
}

/** What directly follows terminator `t`: a paragraph (after a block object, always: its implicit one when none starts there), another terminator with nothing read between, or the flow end. */
export type Following =
  | { readonly k: "paragraph"; readonly L: ParagraphLayout }
  /** A block object or `[S]` (whose kind's category the caller asks). */
  | { readonly k: "terminator"; readonly term: TerminatorRef }
  | { readonly k: "end" };

export function followingOf(d: Document, fs: FlowState, first: TerminatorRef): Following {
  // A table's `⟦` faces outward as the whole table: what follows it is what follows the table. Its implicit paragraph
  // is anchored at its `⟧` (at its `⟦` when unclosed).
  const table = roleOf(first.token) === "open" ? tableExtent(fs, first) : null;
  const t = table?.close ?? first;
  const next = table?.next ?? afterObject(fs, first);
  const { term, units } = nextTerminator(fs, next.seg, next.tok, 0);
  const none = units === 0 && (term === null || !isParagraphBreak(term.token.k));
  if (none && !isBlockObject(t.token.k)) return term === null ? { k: "end" } : { k: "terminator", term };
  const id = none ? afterObjectId(t.token.id) : term === null ? flowEndId(fs.holderId) : isParagraphBreak(term.token.k) ? term.token.id : debrisBeforeId(term.token.id);
  const L = paragraphLayout(d, id);
  return L === null ? { k: "end" } : { k: "paragraph", L };
}

/** The paragraph directly before terminator `t` (debris before an object / `[S]`, or the ¶ paragraph just before it), or null. */
export function paragraphBefore(d: Document, fs: FlowState, t: TerminatorRef): ParagraphLayout | null {
  const { units, before } = unitsBefore(fs, t.seg, t.tok, 0);
  if (units > 0) return isParagraphBreak(t.token.k) ? null : paragraphLayout(d, debrisBeforeId(t.token.id));
  return before !== null && isParagraphBreak(before.token.k) ? paragraphLayout(d, before.token.id) : null;
}
