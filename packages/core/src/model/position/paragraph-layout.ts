/**
 * Model positions over a version (r7 R14–R16): a position is a paragraph id + an
 * offset in the paragraph's READ units (a text item counts its UTF-16 length, an
 * embed counts 1; inert storage counts nothing).
 *
 * Everything here reads one version only — its flow segments (`scan/`) record the
 * storage layout the version was read from, so a position in an OLD version still
 * resolves to the storage point it named then (exact mapping, `mapping/map-position.ts`).
 *
 *   - {@link paragraphLayout}: a paragraph's storage — its run tokens, the terminator
 *     ending it (its ¶; the block object / `[S]` after debris; none at `<end>`) and
 *     the terminator before it.
 *   - {@link pointAfter} (R16): the storage point of an offset is right AFTER the
 *     read unit before it ("end of the earlier piece"); offset 0 is right after the
 *     previous terminator (or the flow start; an empty flow → its first piece, 0).
 *   - {@link pointBefore}: the storage index OF the read unit at an offset (a
 *     deletion's start: inert storage at the edges of a range is never deleted).
 *   - {@link positionAtPoint}: the reverse, for a storage point of the version.
 *   - {@link resolvePosition}: clamp + snap — R16 floats, R14 atomic mark runs,
 *     R15 grapheme clusters.
 *
 * Yjs reads: `Y.getItem` (public) finds the piece holding a terminator item; the
 * version's segments do the rest.
 */
import * as Y from "yjs";
import type { Block, BlockId } from "../block";
import { resolveBlock } from "../document/blocks";
import type { Document, FlowState, TreeKind } from "../document/types";
import { flowEndId } from "../ids";
import type { RunToken, Segment, TerminatorToken } from "../scan/tokens";

/** An insertion point `index` of `piece`, which is segment `seg`'s piece in its flow. */
export interface StoragePoint {
  readonly piece: Y.Text;
  readonly index: number;
  readonly seg: number;
}

/** A terminator token: segment `seg`, token `tok`, at storage index `index` of the segment's piece. */
export interface TerminatorRef {
  readonly seg: number;
  readonly tok: number;
  readonly index: number;
  readonly token: TerminatorToken;
}

/** One run token of a paragraph. */
export interface RunPart {
  readonly seg: number;
  readonly piece: Y.Text;
  /** Storage index of the run's start in its piece. */
  readonly start: number;
  readonly token: RunToken;
  /** Read units of the run. */
  readonly read: number;
  /** The paragraph read offset where the run starts. */
  readonly readStart: number;
}

export interface ParagraphLayout {
  readonly block: Block;
  readonly tree: TreeKind;
  readonly fs: FlowState;
  readonly parts: readonly RunPart[];
  /** Read length (= the record's inline length). */
  readonly length: number;
  /** The paragraph's ¶, or null (debris, R17). */
  readonly mark: Y.Map<unknown> | null;
  /** The terminator ending the paragraph (its ¶, or the object / `[S]` after debris); null at `<end>`. */
  readonly end: TerminatorRef | null;
  /** The terminator before the paragraph; null at the flow start. */
  readonly before: TerminatorRef | null;
  /** The storage point of offset 0; null only for a flow with no piece. */
  readonly head: StoragePoint | null;
}

// ---------------------------------------------------------------------------
// Segment walking
// ---------------------------------------------------------------------------

const tokenStarts = new WeakMap<Segment, readonly number[]>();

/** Storage index of each token of `seg` in its piece (memoized: segments are immutable). */
export function starts(seg: Segment): readonly number[] {
  const memo = tokenStarts.get(seg);
  if (memo !== undefined) return memo;
  const out: number[] = [];
  let i = seg.start;
  for (const t of seg.tokens) {
    out.push(i);
    i += t.len;
  }
  tokenStarts.set(seg, out);
  return out;
}

export const readLength = (t: RunToken): number => t.len - t.inert.length;

function itemOf(doc: Y.Doc, id: string): Y.Item | null {
  const m = /^(\d+):(\d+)$/.exec(id);
  if (m === null) return null;
  const client = Number(m[1]);
  const clock = Number(m[2]);
  if (!Number.isSafeInteger(client) || !Number.isSafeInteger(clock) || clock >= Y.getState(doc.store, client)) return null;
  const s = Y.getItem(doc.store, Y.createID(client, clock));
  return s instanceof Y.Item ? s : null;
}

/** The terminator token with item id `id` in flow `fs`. */
function findTerminator(d: Document, fs: FlowState, id: string): TerminatorRef | null {
  const doc = d.docMap.doc;
  const item = doc === null ? null : itemOf(doc, id);
  const piece = item?.parent;
  const look = (j: number): TerminatorRef | null => {
    const seg = fs.segments[j];
    if (seg === undefined) return null;
    const st = starts(seg);
    for (let t = 0; t < seg.tokens.length; t++) {
      const token = seg.tokens[t];
      const index = st[t];
      if (token !== undefined && index !== undefined && token.k !== "run" && token.id === id) return { seg: j, tok: t, index, token };
    }
    return null;
  };
  if (piece instanceof Y.Text) {
    for (const j of fs.segIndex.get(piece) ?? []) {
      const r = look(j);
      if (r !== null) return r;
    }
    return null;
  }
  // ponytail: the item is gone (GC'd) — scan the whole flow (only an old version's deleted ¶).
  for (let j = 0; j < fs.segments.length; j++) {
    const r = look(j);
    if (r !== null) return r;
  }
  return null;
}

/** The terminator token (¶ / TOC / `[S]`) with item id `id` in flow `fs` of version `d`. */
export function terminatorOf(d: Document, fs: FlowState, id: string): TerminatorRef | null {
  return findTerminator(d, fs, id);
}

/** The flow a record of `tree` belongs to (cells arrive in P2). */
export function flowOfBlock(d: Document, block: Block, tree: TreeKind): FlowState | undefined {
  const holder = tree === "block" ? d.rootId : block.parentId;
  return holder === null ? undefined : d.flows.get(holder);
}

/** The point right after a terminator. */
function afterTerminator(fs: FlowState, t: TerminatorRef): StoragePoint | null {
  const seg = fs.segments[t.seg];
  return seg === undefined ? null : { piece: seg.piece, index: t.index + t.token.len, seg: t.seg };
}

function flowStart(fs: FlowState): StoragePoint | null {
  const seg = fs.segments[0];
  return seg === undefined ? null : { piece: seg.piece, index: seg.start, seg: 0 };
}

/**
 * Walk backward from (seg, tok) exclusive: the run tokens up to the previous
 * terminator (returned in order) and that terminator.
 */
export function runsBefore(fs: FlowState, seg: number, tok: number): { runs: { seg: number; tok: number }[]; before: TerminatorRef | null } {
  const runs: { seg: number; tok: number }[] = [];
  for (let j = seg, t = tok - 1; j >= 0; j--) {
    const s = fs.segments[j];
    if (s === undefined) break;
    if (j !== seg) t = s.tokens.length - 1;
    for (; t >= 0; t--) {
      const token = s.tokens[t];
      if (token === undefined) continue;
      if (token.k === "run") runs.push({ seg: j, tok: t });
      else {
        const index = starts(s)[t];
        return { runs: runs.reverse(), before: index === undefined ? null : { seg: j, tok: t, index, token } };
      }
    }
  }
  return { runs: runs.reverse(), before: null };
}

/** The storage layout of paragraph `id` in version `d`, or null when `id` is not a paragraph of `d`. */
export function paragraphLayout(d: Document, id: BlockId): ParagraphLayout | null {
  const r = resolveBlock(d, id);
  if (r === null || r.block.inlineContent === null) return null;
  const fs = flowOfBlock(d, r.block, r.kind);
  if (fs === undefined) return null;
  let end: TerminatorRef | null = null;
  let from: { seg: number; tok: number };
  if (id === flowEndId(fs.holderId)) {
    const j = fs.segments.length - 1;
    from = { seg: Math.max(0, j), tok: fs.segments[j]?.tokens.length ?? 0 };
  } else {
    const termId = id.endsWith("/pre") ? id.slice(0, -"/pre".length) : id;
    end = findTerminator(d, fs, termId);
    // A ¶ id names its own ¶; a `/pre` id names the block object / [S] after the debris.
    const isDebris = termId !== id;
    if (end === null || isDebris === (end.token.k === "para")) return null;
    from = { seg: end.seg, tok: end.tok };
  }
  const { runs, before } = runsBefore(fs, from.seg, from.tok);
  const parts: RunPart[] = [];
  let readStart = 0;
  for (const { seg, tok } of runs) {
    const s = fs.segments[seg];
    const token = s?.tokens[tok];
    const start = s === undefined ? undefined : starts(s)[tok];
    if (s === undefined || token === undefined || token.k !== "run" || start === undefined) continue;
    const read = readLength(token);
    parts.push({ seg, piece: s.piece, start, token, read, readStart });
    readStart += read;
  }
  const head = before !== null ? afterTerminator(fs, before) : flowStart(fs);
  return { block: r.block, tree: r.kind, fs, parts, length: readStart, mark: end !== null && end.token.k === "para" ? end.token.map : null, end, before, head };
}
