import type { Document, FlowState } from "../document/types";
import { debrisBeforeId, flowEndId } from "../ids";
import { isParagraphBreak } from "../scan/kinds";
import { type ParagraphLayout, type TerminatorRef, paragraphLayout, readLength, runsBefore, starts } from "./paragraph-layout";

/** The next terminator at or after (seg, tok), and whether read units lie before it. */
export function nextTerminator(fs: FlowState, seg: number, tok: number, within: number): { term: TerminatorRef | null; units: number } {
  let units = 0;
  for (let j = seg, t = tok; j < fs.segments.length; j++, t = 0) {
    const s = fs.segments[j];
    if (s === undefined) break;
    for (; t < s.tokens.length; t++) {
      const token = s.tokens[t];
      if (token === undefined) continue;
      if (token.k === "run") {
        units += readLength(token) - (j === seg && t === tok ? within : 0);
        continue;
      }
      const index = starts(s)[t];
      return { term: index === undefined ? null : { seg: j, tok: t, index, token }, units };
    }
  }
  return { term: null, units };
}

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

/** What directly follows terminator `t`: a paragraph, another terminator with nothing read between, or the flow end. */
export type Following =
  | { readonly k: "paragraph"; readonly L: ParagraphLayout }
  /** A block object or `[S]` (whose kind's category the caller asks). */
  | { readonly k: "terminator"; readonly term: TerminatorRef }
  | { readonly k: "end" };

export function followingOf(d: Document, fs: FlowState, t: TerminatorRef): Following {
  const seg = fs.segments[t.seg];
  const next = seg !== undefined && t.tok + 1 < seg.tokens.length ? { seg: t.seg, tok: t.tok + 1 } : { seg: t.seg + 1, tok: 0 };
  const { term, units } = nextTerminator(fs, next.seg, next.tok, 0);
  if (units === 0 && term === null) return { k: "end" };
  if (units === 0 && term !== null && !isParagraphBreak(term.token.k)) return { k: "terminator", term };
  const id = term === null ? flowEndId(fs.holderId) : isParagraphBreak(term.token.k) ? term.token.id : debrisBeforeId(term.token.id);
  const L = paragraphLayout(d, id);
  return L === null ? { k: "end" } : { k: "paragraph", L };
}

/** The paragraph directly before terminator `t` (debris before an object / `[S]`, or the ¶ paragraph just before it), or null. */
export function paragraphBefore(d: Document, fs: FlowState, t: TerminatorRef): ParagraphLayout | null {
  const { units, before } = unitsBefore(fs, t.seg, t.tok, 0);
  if (units > 0) return isParagraphBreak(t.token.k) ? null : paragraphLayout(d, debrisBeforeId(t.token.id));
  return before !== null && isParagraphBreak(before.token.k) ? paragraphLayout(d, before.token.id) : null;
}
