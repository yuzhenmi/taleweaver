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
import { emptyCellParagraphId, flowEndId } from "../ids";
import { type RunToken, type TerminatorToken, depthOf, roleOf } from "../scan/tokens";
import { isBlockObject, isParagraphBreak } from "../scan/kinds";
import { afterObject, tableExtent } from "./table-extent";

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
  /** Nothing stored (an empty holder's paragraph, R17; a block object's implicit one): a write there creates its ¶ first (X2 / X5). */
  readonly implicit: boolean;
  /**
   * A virtual end cell's paragraph (design: short rows): the cell is the `rank`-th (from 1)
   * virtual cell of its row, its table's marks at `depth`. Its first write makes real `⟨c⟩¶`
   * cells up to it, and its own `⟨c⟩`, before its ¶.
   */
  readonly virtualCell?: {
    readonly rank: number;
    readonly depth: number;
    /** The row's first virtual cell holds content (a lead joins it, F2): made real, it needs no ¶ of its own. */
    readonly firstHolds: boolean;
  };
}

// ---------------------------------------------------------------------------
// Segment walking
// ---------------------------------------------------------------------------

export { starts } from "./token-starts";
import { starts } from "./token-starts";

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

/** The flow a record of `tree` belongs to: the body, or its nearest holder ancestor (through table cells, at most the nesting cap). */
export function flowOfBlock(d: Document, block: Block, tree: TreeKind): FlowState | undefined {
  if (tree === "block") return d.flows.get(d.rootId);
  for (let id = block.parentId; id !== null; id = d.trees[tree].get(id)?.parentId ?? null) {
    const fs = d.flows.get(id);
    if (fs !== undefined) return fs;
  }
  return undefined;
}

/** The point right after a terminator. */
function afterTerminator(fs: FlowState, t: TerminatorRef): StoragePoint | null {
  const seg = fs.segments[t.seg];
  return seg === undefined ? null : { piece: seg.piece, index: t.index + t.token.len, seg: t.seg };
}

/** The flow's start point (before its first segment), or null for a flow with no piece. */
export function flowStart(fs: FlowState): StoragePoint | null {
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
  let implicit = fs.synthetic;
  const last = fs.segments.length - 1;
  const flowEnd = { seg: Math.max(0, last), tok: fs.segments[last]?.tokens.length ?? 0 };
  if (id === flowEndId(fs.holderId)) {
    from = flowEnd;
  } else if (id.endsWith("/empty")) {
    return emptyCellLayout(d, fs, r.block, r.kind, id.slice(0, -"/empty".length));
  } else if (id.endsWith("/after")) {
    // The implicit paragraph after a block object: nothing read up to the next terminator, a non-¶ one (or `<end>`).
    const object = findTerminator(d, fs, id.slice(0, -"/after".length));
    if (object === null || !isBlockObject(object.token.k)) return null;
    const open = roleOf(object.token) === "open" ? tableExtent(fs, object) : null;
    const next = open?.next ?? afterObject(fs, object);
    const n = nextTerminator(fs, next.seg, next.tok, 0);
    if (n.units > 0 || (n.term !== null && isParagraphBreak(n.term.token.k))) return null;
    // An unclosed table's (concurrency only): nothing of it is stored; its head is where the table ends, at the
    // `[S]` / mark / `<end>` closing it. ponytail: its first write must also write the table's `⟧` (N3).
    if (open !== null && open.close === null) {
      return { block: r.block, tree: r.kind, fs, parts: [], length: 0, mark: null, end: n.term, before: object, head: open.end, implicit: true };
    }
    end = n.term;
    from = end ?? flowEnd;
    implicit = true;
  } else {
    const termId = id.endsWith("/pre") ? id.slice(0, -"/pre".length) : id;
    end = findTerminator(d, fs, termId);
    // A ¶ id names its own ¶; a `/pre` id names the block object / [S] after the debris.
    const isDebris = termId !== id;
    if (end === null || isDebris === isParagraphBreak(end.token.k)) return null;
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
  return { block: r.block, tree: r.kind, fs, parts, length: readStart, mark: end !== null && isParagraphBreak(end.token.k) ? end.token.map : null, end, before, head, implicit };
}

/**
 * The layout of a cell paragraph with nothing stored (§5): `${cell}/empty` of a real cell (`⟨c⟩` with a mark next;
 * its head right after the `⟨c⟩`), or of a virtual end cell `${M}/fill<col>` (its head AT its row's next mark M, a
 * real item, so a caret there is stored like any other; for the last row of an unclosed table, whose cells are named
 * after its `⟦`, at the table's extent end, before the `[S]` / mark / `<end>` closing it). Null otherwise.
 */
function emptyCellLayout(d: Document, fs: FlowState, block: Block, tree: TreeKind, cellId: BlockId): ParagraphLayout | null {
  const fillAt = cellId.lastIndexOf("/fill");
  if (fillAt < 0) {
    const open = findTerminator(d, fs, cellId);
    if (open === null || roleOf(open.token) !== "newCell") return null;
    const next = afterObject(fs, open);
    const n = nextTerminator(fs, next.seg, next.tok, 0);
    const role = n.term === null ? null : roleOf(n.term.token);
    if (n.units > 0 || role === null || role === "open") return null;
    return { block, tree, fs, parts: [], length: 0, mark: null, end: n.term, before: open, head: afterTerminator(fs, open), implicit: true };
  }
  const markId = cellId.slice(0, fillAt);
  const m = findTerminator(d, fs, markId);
  const role = m === null ? null : roleOf(m.token);
  const seg = m === null ? undefined : fs.segments[m.seg];
  if (m === null || seg === undefined || (role !== "newRow" && role !== "close" && role !== "open")) return null;
  const unclosed = role === "open" ? tableExtent(fs, m) : null;
  if (role === "open" && (unclosed === null || unclosed.close !== null)) return null;
  // Its rank among its row's virtual cells (they all follow the row's real ones).
  const rowId = d.trees[tree].get(block.parentId ?? "")?.parentId ?? null;
  let rank = 0;
  let found = false;
  let firstHolds = false;
  for (let c = rowId === null ? null : (d.trees[tree].get(rowId)?.firstChildId ?? null); c !== null && !found; c = d.trees[tree].get(c)?.nextSiblingId ?? null) {
    if (c.startsWith(`${markId}/fill`) && ++rank === 1) firstHolds = d.trees[tree].get(c)?.firstChildId !== emptyCellParagraphId(c);
    found = c === cellId;
  }
  if (!found) return null;
  const head = unclosed?.end ?? { piece: seg.piece, index: m.index, seg: m.seg };
  const end = unclosed === null ? m : nextTerminator(fs, unclosed.next.seg, unclosed.next.tok, 0).term;
  // Its notional `⟨c⟩` would be the terminator before it: the row's end mark (an unclosed table's `⟦`, from inside a
  // container start) stands in (a container boundary, as a real empty cell's `⟨c⟩` is), so nothing joins across it (C5).
  return { block, tree, fs, parts: [], length: 0, mark: null, end, before: m, head, implicit: true, virtualCell: { rank, depth: depthOf(m.token) ?? 0, firstHolds } };
}
