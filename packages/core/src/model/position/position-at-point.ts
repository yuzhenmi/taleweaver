import type * as Y from "yjs";
import type { BlockId } from "../block";
import { resolveBlock } from "../document/blocks";
import type { Document, FlowState } from "../document/types";
import { debrisBeforeId, flowEndId } from "../ids";
import { type Assoc, type ModelPosition, position } from "./model-position";
import { type TerminatorRef, starts } from "./paragraph-layout";
import { nextTerminator, unitsBefore } from "./terminator-neighbours";
import { isParagraphBreak } from "../scan/kinds";
import { unitsOf } from "./items";

/** Read units before run-relative storage offset `s`. */
function readBefore(inert: readonly number[], s: number): number {
  let n = 0;
  for (const g of inert) {
    if (g < s) n++;
    else break;
  }
  return s - n;
}

// ---------------------------------------------------------------------------
// Storage point → position
// ---------------------------------------------------------------------------

interface Located {
  readonly seg: number;
  /** The token the point is in or before (tokens.length = after the segment's last). */
  readonly tok: number;
  /** Read units of token `tok` before the point (0 unless the point is inside a run). */
  readonly within: number;
}

function locate(fs: FlowState, piece: Y.Text, index: number): Located | null {
  for (const j of fs.segIndex.get(piece) ?? []) {
    const seg = fs.segments[j];
    if (seg === undefined || index < seg.start || index > seg.start + seg.len) continue;
    const st = starts(seg);
    for (let t = 0; t < seg.tokens.length; t++) {
      const token = seg.tokens[t];
      const s = st[t];
      if (token === undefined || s === undefined) continue;
      if (index < s + token.len) {
        return { seg: j, tok: t, within: token.k === "run" ? readBefore(token.inert, index - s) : 0 };
      }
    }
    return { seg: j, tok: seg.tokens.length, within: 0 };
  }
  return null;
}

/**
 * The position at storage point (`piece`, `index`) of version `d`'s flow `fs`, or
 * null when the piece is not read there. A point in no paragraph (between a
 * terminator and a block object with nothing read between) goes to the nearest
 * paragraph on the `assoc` side (the other side when there is none).
 */
export function positionAtPoint(d: Document, fs: FlowState, piece: Y.Text, index: number, assoc: Assoc): ModelPosition | null {
  const at = locate(fs, piece, index);
  if (at === null) return null;
  return positionAt(d, fs, at, assoc);
}

/** The terminator starting exactly at storage point (`piece`, `index`) of flow `fs`, or null (a run there, or the flow end). */
export function terminatorAtPoint(fs: FlowState, piece: Y.Text, index: number): TerminatorRef | null {
  const at = locate(fs, piece, index);
  const seg = at === null ? undefined : fs.segments[at.seg];
  const token = at === null ? undefined : seg?.tokens[at.tok];
  const start = at === null || seg === undefined ? undefined : starts(seg)[at.tok];
  return at === null || token === undefined || token.k === "run" || start !== index ? null : { seg: at.seg, tok: at.tok, index, token };
}

function blockLength(d: Document, id: BlockId): number | null {
  const items = resolveBlock(d, id)?.block.inlineContent?.items;
  if (items === undefined) return null;
  let n = 0;
  for (const i of items) n += unitsOf(i);
  return n;
}

type Probe = { readonly pos: ModelPosition } | { readonly after: TerminatorRef | null; readonly before: TerminatorRef | null };

/** The position at `at`, or — in no paragraph — the terminators either side. */
function probe(fs: FlowState, at: Located): Probe {
  const after = nextTerminator(fs, at.seg, at.tok, at.within);
  const before = unitsBefore(fs, at.seg, at.tok, at.within);
  const t = after.term;
  if (t !== null && isParagraphBreak(t.token.k)) return { pos: position(t.token.id, before.units) };
  if (before.units + after.units > 0) return { pos: position(t === null ? flowEndId(fs.holderId) : debrisBeforeId(t.token.id), before.units) };
  if (t === null && fs.synthetic) return { pos: position(flowEndId(fs.holderId), 0) };
  return { after: t, before: before.before };
}

/**
 * The position at `at`; in no paragraph, the nearest one on the `assoc` side, else
 * the other. A loop, not recursion: a peer can store any number of abutting terminators.
 */
function positionAt(d: Document, fs: FlowState, at: Located, assoc: Assoc): ModelPosition | null {
  const first = probe(fs, at);
  if ("pos" in first) return first.pos;
  const walk = (dir: Assoc): ModelPosition | null => {
    let p: Probe = first;
    for (;;) {
      if ("pos" in p) return p.pos;
      if (dir > 0) {
        const t = p.after;
        if (t === null) return null;
        const next = t.tok + 1 < (fs.segments[t.seg]?.tokens.length ?? 0) ? { seg: t.seg, tok: t.tok + 1, within: 0 } : { seg: t.seg + 1, tok: 0, within: 0 };
        if (next.seg >= fs.segments.length) return null;
        p = probe(fs, next);
      } else {
        const b = p.before;
        if (b === null) return null;
        if (isParagraphBreak(b.token.k)) {
          const len = blockLength(d, b.token.id);
          return len === null ? null : position(b.token.id, len);
        }
        p = probe(fs, { seg: b.seg, tok: b.tok, within: 0 });
      }
    }
  };
  return walk(assoc) ?? walk(assoc < 0 ? 1 : -1);
}
