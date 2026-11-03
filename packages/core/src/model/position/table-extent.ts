/**
 * A table's storage extent, by RT1 restated for one bracket (`derive/table/parse-tables.ts`):
 * from its `⟦` (depth d) to its first `⟧` of depth d, or up to the `[S]`, the mark of a
 * shallower depth or the flow end that closes it. Marks of depth > d are its nested
 * tables' and do not end it. Inert marks are no terminators in a version's segments
 * (`derive/table/inert-marks.ts`), so this agrees with the parse.
 */
import type { FlowState } from "../document/types";
import { holdsFlows, isBlockObject, isSectionBreak } from "../scan/kinds";
import { type TerminatorToken, depthOf, roleOf } from "../scan/tokens";
import type { StoragePoint, TerminatorRef } from "./paragraph-layout";
import { starts } from "./token-starts";

/** A token position: token `tok` of segment `seg` (`tok` = the segment's length, `seg` = the flow's: past the end). */
export interface TokenPos {
  readonly seg: number;
  readonly tok: number;
}

export interface TableExtent {
  /** The point right after the table's last item. */
  readonly end: StoragePoint;
  /** The token right after the table (its closing `[S]` / shallower mark when unclosed). */
  readonly next: TokenPos;
  /** Its `⟧`, or null when it is unclosed. */
  readonly close: TerminatorRef | null;
}

/** The extent of the table whose `⟦` is `open`; null when `open` is not a bound `⟦` of `fs`. */
export function tableExtent(fs: FlowState, open: TerminatorRef): TableExtent | null {
  const d = depthOf(open.token);
  if (d === null) return null;
  let last: StoragePoint | null = null;
  for (let j = open.seg; j < fs.segments.length; j++) {
    const seg = fs.segments[j];
    if (seg === undefined) break;
    const st = starts(seg);
    for (let t = j === open.seg ? open.tok + 1 : 0; t < seg.tokens.length; t++) {
      const token = seg.tokens[t];
      const index = st[t];
      if (token === undefined || index === undefined || token.k === "run") continue;
      const here = { piece: seg.piece, index, seg: j };
      if (isSectionBreak(token.k)) return { end: here, next: { seg: j, tok: t }, close: null };
      if (!holdsFlows(token.k)) continue;
      const dd = depthOf(token);
      if (dd === null || dd > d) continue;
      if (dd < d) return { end: here, next: { seg: j, tok: t }, close: null };
      if (roleOf(token) === "close") return { end: { ...here, index: index + token.len }, next: tokenAfter(fs, j, t), close: { seg: j, tok: t, index, token } };
    }
    last = { piece: seg.piece, index: seg.start + seg.len, seg: j };
  }
  return last === null ? null : { end: last, next: { seg: fs.segments.length, tok: 0 }, close: null };
}

const tokenAfter = (fs: FlowState, seg: number, tok: number): TokenPos =>
  tok + 1 < (fs.segments[seg]?.tokens.length ?? 0) ? { seg, tok: tok + 1 } : { seg: seg + 1, tok: 0 };

/** The token right after block object `t` (a table's `⟦`: after the whole table). */
export function afterObject(fs: FlowState, t: TerminatorRef): TokenPos {
  if (roleOf(t.token) === "open") {
    const x = tableExtent(fs, t);
    if (x !== null) return x.next;
  }
  return tokenAfter(fs, t.seg, t.tok);
}

/** Seen from right after it, a terminator reads as a block object: a TOC, or a table's `⟧` (`⟦`, `⟨r⟩` and `⟨c⟩` start a container). */
export const isObjectEnd = (t: TerminatorToken): boolean => isBlockObject(t.k) && (!holdsFlows(t.k) || roleOf(t) === "close");
