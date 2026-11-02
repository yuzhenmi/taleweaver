/**
 * Model positions over a version (r7 R14–R16): a position is a paragraph id + an
 * offset in the paragraph's READ units (a text item counts its UTF-16 length, an
 * embed counts 1; inert storage counts nothing).
 *
 * Everything here reads one version only — its flow segments (`scan.ts`) record the
 * storage layout the version was read from, so a position in an OLD version still
 * resolves to the storage point it named then (exact mapping, `mapping.ts`).
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
import type { Block, BlockId, InlineItem, ReadonlyAttrs } from "./block";
import { EMBED_TYPES, valueEqual } from "./block";
import type { Document, FlowState, TreeKind } from "./derive";
import { endsJoiningForward, type RunToken, type Segment, type TerminatorToken } from "./scan";
import { debrisBeforeId, flowEndId } from "./ids";
import { resolveBlock } from "./document";

export interface ModelPosition {
  readonly blockId: BlockId;
  readonly offset: number;
  /**
   * A LEADING endpoint (offset 0 only): before the block objects that directly
   * precede the paragraph, not at its first caret position. Produced by select-all
   * and by a TOC's object selection; a range starting here deletes those objects (C9).
   */
  readonly leading?: true;
}

export interface ModelSelection {
  readonly anchor: ModelPosition;
  readonly focus: ModelPosition;
}

export const position = (blockId: BlockId, offset: number): ModelPosition => ({ blockId, offset });

export function caretAt(blockId: BlockId, offset: number): ModelSelection {
  const p = position(blockId, offset);
  return { anchor: p, focus: p };
}

/** Which side an ambiguous position sticks to: `-1` stays before an insertion at it, `1` moves after (ProseMirror's convention). */
export type Assoc = -1 | 1;

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

/** Storage offset (run-relative) just after the `q`-th read unit of a run, q ≥ 1. */
function storageAfter(inert: readonly number[], q: number): number {
  let s = q;
  for (const g of inert) {
    if (g < s) s++;
    else break;
  }
  return s;
}

/** Storage offset (run-relative) of the `q`-th read unit (0-based) of a run. */
function storageOf(inert: readonly number[], q: number): number {
  let s = q;
  for (const g of inert) {
    if (g <= s) s++;
    else break;
  }
  return s;
}

/** Read units before run-relative storage offset `s`. */
function readBefore(inert: readonly number[], s: number): number {
  let n = 0;
  for (const g of inert) {
    if (g < s) n++;
    else break;
  }
  return s - n;
}

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

/** The flow's end point (after its last segment), or null for a flow with no piece. */
function flowEnd(fs: FlowState): StoragePoint | null {
  const j = fs.segments.length - 1;
  const seg = fs.segments[j];
  return seg === undefined ? null : { piece: seg.piece, index: seg.start + seg.len, seg: j };
}

function flowStart(fs: FlowState): StoragePoint | null {
  const seg = fs.segments[0];
  return seg === undefined ? null : { piece: seg.piece, index: seg.start, seg: 0 };
}

/**
 * Walk backward from (seg, tok) exclusive: the run tokens up to the previous
 * terminator (returned in order) and that terminator.
 */
function runsBefore(fs: FlowState, seg: number, tok: number): { runs: { seg: number; tok: number }[]; before: TerminatorRef | null } {
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

/**
 * The point before the block objects (TOCs) directly preceding paragraph `L` — with
 * nothing read between them — or null when none does. A LEADING endpoint
 * ({@link ModelPosition.leading}) sits there: the start of select-all over a leading
 * TOC, or of a TOC's object selection.
 */
export function objectsStart(L: ParagraphLayout): StoragePoint | null {
  let first: TerminatorRef | null = null;
  for (let t = L.before; t !== null && t.token.k === "toc"; ) {
    first = t;
    const { runs, before } = runsBefore(L.fs, t.seg, t.tok);
    if (runs.some((r) => {
      const token = L.fs.segments[r.seg]?.tokens[r.tok];
      return token !== undefined && token.k === "run" && readLength(token) > 0;
    })) break;
    t = before;
  }
  const seg = first === null ? undefined : L.fs.segments[first.seg];
  return first === null || seg === undefined ? null : { piece: seg.piece, index: first.index, seg: first.seg };
}

/** R16: the insertion point of `offset` (clamped): right after the read unit before it. */
export function pointAfter(L: ParagraphLayout, offset: number): StoragePoint | null {
  const off = Math.min(Math.max(0, offset), L.length);
  if (off === 0) return L.head;
  for (const p of L.parts) {
    if (p.read === 0 || off > p.readStart + p.read) continue;
    return { piece: p.piece, index: p.start + storageAfter(p.token.inert, off - p.readStart), seg: p.seg };
  }
  return L.head;
}

/** The storage index OF the read unit at `offset` (at the paragraph's end: its terminator, or the flow end). */
export function pointBefore(L: ParagraphLayout, offset: number): StoragePoint | null {
  const off = Math.min(Math.max(0, offset), L.length);
  if (off < L.length) {
    for (const p of L.parts) {
      if (p.read === 0 || off >= p.readStart + p.read) continue;
      return { piece: p.piece, index: p.start + storageOf(p.token.inert, off - p.readStart), seg: p.seg };
    }
  }
  if (L.end !== null) {
    const seg = L.fs.segments[L.end.seg];
    return seg === undefined ? null : { piece: seg.piece, index: L.end.index, seg: L.end.seg };
  }
  return L.fs.synthetic ? L.head : flowEnd(L.fs);
}

/** Order of two storage points of one flow. */
export function comparePoints(a: StoragePoint, b: StoragePoint): number {
  return a.seg - b.seg || a.index - b.index;
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

/** The next terminator at or after (seg, tok), and whether read units lie before it. */
function nextTerminator(fs: FlowState, seg: number, tok: number, within: number): { term: TerminatorRef | null; units: number } {
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
function unitsBefore(fs: FlowState, seg: number, tok: number, within: number): { units: number; before: TerminatorRef | null } {
  const { runs, before } = runsBefore(fs, seg, tok);
  let units = within;
  for (const r of runs) {
    const token = fs.segments[r.seg]?.tokens[r.tok];
    if (token !== undefined && token.k === "run") units += readLength(token);
  }
  return { units, before };
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

function blockLength(d: Document, id: BlockId): number | null {
  const items = resolveBlock(d, id)?.block.inlineContent?.items;
  if (items === undefined) return null;
  let n = 0;
  for (const i of items) n += i.kind === "text" ? i.text.length : 1;
  return n;
}

type Probe = { readonly pos: ModelPosition } | { readonly after: TerminatorRef | null; readonly before: TerminatorRef | null };

/** The position at `at`, or — in no paragraph — the terminators either side. */
function probe(fs: FlowState, at: Located): Probe {
  const after = nextTerminator(fs, at.seg, at.tok, at.within);
  const before = unitsBefore(fs, at.seg, at.tok, at.within);
  const t = after.term;
  if (t !== null && t.token.k === "para") return { pos: position(t.token.id, before.units) };
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
        if (b.token.k === "para") {
          const len = blockLength(d, b.token.id);
          return len === null ? null : position(b.token.id, len);
        }
        p = probe(fs, { seg: b.seg, tok: b.tok, within: 0 });
      }
    }
  };
  return walk(assoc) ?? walk(assoc < 0 ? 1 : -1);
}

/** What directly follows terminator `t`: a paragraph, another terminator with nothing read between, or the flow end. */
export type Following =
  | { readonly k: "para"; readonly L: ParagraphLayout }
  | { readonly k: "toc" | "S"; readonly term: TerminatorRef }
  | { readonly k: "end" };

export function followingOf(d: Document, fs: FlowState, t: TerminatorRef): Following {
  const seg = fs.segments[t.seg];
  const next = seg !== undefined && t.tok + 1 < seg.tokens.length ? { seg: t.seg, tok: t.tok + 1 } : { seg: t.seg + 1, tok: 0 };
  const { term, units } = nextTerminator(fs, next.seg, next.tok, 0);
  if (units > 0 || (term !== null && term.token.k === "para")) {
    const id = term === null ? flowEndId(fs.holderId) : term.token.k === "para" ? term.token.id : debrisBeforeId(term.token.id);
    const L = paragraphLayout(d, id);
    return L === null ? { k: "end" } : { k: "para", L };
  }
  if (term === null) return { k: "end" };
  return { k: term.token.k === "toc" ? "toc" : "S", term };
}

/** The paragraph directly before terminator `t` (debris before an object / `[S]`, or the ¶ paragraph just before it), or null. */
export function paragraphBefore(d: Document, fs: FlowState, t: TerminatorRef): ParagraphLayout | null {
  const { units, before } = unitsBefore(fs, t.seg, t.tok, 0);
  if (units > 0) return t.token.k === "para" ? null : paragraphLayout(d, debrisBeforeId(t.token.id));
  return before !== null && before.token.k === "para" ? paragraphLayout(d, before.token.id) : null;
}

// ---------------------------------------------------------------------------
// Resolution (R14 / R15 / R16)
// ---------------------------------------------------------------------------

export interface PositionOptions {
  /** R14: mark keys whose maximal equal runs are atomic units (default: none). */
  readonly isAtomicMark?: (key: string) => boolean;
}

export const unitsOf = (i: InlineItem): number => (i.kind === "text" ? i.text.length : 1);

export const isFloat = (i: InlineItem | undefined): boolean =>
  i !== undefined && i.kind === "embed" && i.embedType === EMBED_TYPES.object && typeof i.properties["wrap"] === "string";

// ---------------------------------------------------------------------------
// Items around an offset. Plans read a paragraph's items through its layout's run
// tokens — one token per segment — so finding the item at an offset costs the
// paragraph's segment count plus a search in one token (piece-bounded), not a scan
// of every item of the paragraph.
// ---------------------------------------------------------------------------

/** An item of a paragraph: its read start, and where it sits (part `p`, item `i` of that part's token). */
export interface ItemRef {
  readonly item: InlineItem;
  readonly start: number;
  readonly p: number;
  readonly i: number;
}

const itemStartsMemo = new WeakMap<RunToken, readonly number[]>();

/** Read offsets (token-relative) of a run token's items (memoized: tokens are immutable). */
function itemStarts(t: RunToken): readonly number[] {
  const memo = itemStartsMemo.get(t);
  if (memo !== undefined) return memo;
  const out: number[] = [];
  let n = 0;
  for (const i of t.items) {
    out.push(n);
    n += unitsOf(i);
  }
  itemStartsMemo.set(t, out);
  return out;
}

function refOf(L: ParagraphLayout, p: number, i: number): ItemRef | null {
  const part = L.parts[p];
  const item = part?.token.items[i];
  const rel = part === undefined ? undefined : itemStarts(part.token)[i];
  return part === undefined || item === undefined || rel === undefined ? null : { item, start: part.readStart + rel, p, i };
}

/** The item holding read unit `offset`, or null past the end. */
export function itemAt(L: ParagraphLayout, offset: number): ItemRef | null {
  for (let p = 0; p < L.parts.length; p++) {
    const part = L.parts[p];
    if (part === undefined || part.read === 0 || offset < part.readStart || offset >= part.readStart + part.read) continue;
    const st = itemStarts(part.token);
    const rel = offset - part.readStart;
    let lo = 0;
    let hi = st.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((st[mid] ?? 0) <= rel) lo = mid;
      else hi = mid - 1;
    }
    return refOf(L, p, lo);
  }
  return null;
}

/** The item holding read unit `offset − 1`. */
export const itemBefore = (L: ParagraphLayout, offset: number): ItemRef | null => (offset <= 0 ? null : itemAt(L, offset - 1));

export function prevItem(L: ParagraphLayout, r: ItemRef): ItemRef | null {
  if (r.i > 0) return refOf(L, r.p, r.i - 1);
  for (let p = r.p - 1; p >= 0; p--) {
    const n = L.parts[p]?.token.items.length ?? 0;
    if (n > 0) return refOf(L, p, n - 1);
  }
  return null;
}

export function nextItem(L: ParagraphLayout, r: ItemRef): ItemRef | null {
  if (r.i + 1 < (L.parts[r.p]?.token.items.length ?? 0)) return refOf(L, r.p, r.i + 1);
  for (let p = r.p + 1; p < L.parts.length; p++) if ((L.parts[p]?.token.items.length ?? 0) > 0) return refOf(L, p, 0);
  return null;
}

/** The text items either side of `offset` (embeds skipped); both the same item when `offset` is strictly inside one. */
export function textNeighbours(L: ParagraphLayout, offset: number): { before: ItemRef | null; after: ItemRef | null } {
  const at = itemAt(L, offset);
  if (at !== null && at.item.kind === "text" && at.start < offset) return { before: at, after: at };
  let after = at;
  while (after !== null && after.item.kind !== "text") after = nextItem(L, after);
  let before = itemBefore(L, offset);
  while (before !== null && before.item.kind !== "text") before = prevItem(L, before);
  return { before, after };
}

// ---------------------------------------------------------------------------
// Graphemes (R15), atomic marks (R14)
// ---------------------------------------------------------------------------

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const WINDOW = 64;

/**
 * Grapheme cluster boundaries of `text` near `offset`. A boundary is certain between
 * two code units of U+0020..U+02FF (the fast path); otherwise a window of
 * ±{@link WINDOW} units is segmented.
 * ponytail: a regional-indicator run longer than the window may pair wrongly; segment
 * from the item start if flags-in-bulk ever matter.
 */
function boundariesNear(text: string, offset: number): number[] {
  const a = Math.max(0, offset - WINDOW);
  const b = Math.min(text.length, offset + WINDOW);
  const out: number[] = [];
  for (const seg of graphemes.segment(text.slice(a, b))) out.push(a + seg.index);
  out.push(b);
  return out;
}

const isSimple = (x: number, y: number): boolean => x >= 0x20 && x < 0x300 && y >= 0x20 && y < 0x300;
const simplePair = (text: string, i: number): boolean => isSimple(text.charCodeAt(i - 1), text.charCodeAt(i));

/** `offset` snapped down to a grapheme cluster boundary of `text`. */
export function graphemeFloor(text: string, offset: number): number {
  if (offset <= 0 || offset >= text.length || simplePair(text, offset)) return offset;
  let best = 0;
  for (const x of boundariesNear(text, offset)) if (x <= offset) best = x;
  return best;
}

/** The previous (`dir` −1) / next (+1) grapheme boundary of `text` from a boundary `offset`. */
export function graphemeStep(text: string, offset: number, dir: -1 | 1): number {
  if (dir < 0) {
    if (offset <= 0) return 0;
    if (offset >= 2 && simplePair(text, offset - 1)) return offset - 1;
    let best = 0;
    for (const x of boundariesNear(text, offset)) if (x < offset) best = x;
    return best;
  }
  if (offset >= text.length) return text.length;
  if (offset + 1 < text.length && simplePair(text, offset + 1)) return offset + 1;
  for (const x of boundariesNear(text, offset)) if (x > offset) return x;
  return text.length;
}

/**
 * The paragraph's merged TEXT around read unit `unit`: the text items holding it and
 * its text neighbours — whatever their formatting — joined across parts (piece /
 * segment boundaries), up to the nearest embeds, clipped to ±{@link WINDOW} units.
 * Null when `unit` is not text. Every per-text reading rule (R15) reads through this,
 * so neither storage splits nor formatting changes ever split a cluster.
 */
export function textRunAt(L: ParagraphLayout, unit: number): { readonly text: string; readonly start: number } | null {
  const seed = itemAt(L, unit);
  if (seed === null || seed.item.kind !== "text") return null;
  const same = (r: ItemRef | null): r is ItemRef => r !== null && r.item.kind === "text";
  const lo = unit - WINDOW;
  const hi = unit + WINDOW;
  let left = seed;
  for (let p = prevItem(L, left); left.start > lo && same(p); p = prevItem(L, left)) left = p;
  let text = "";
  const start = Math.max(left.start, lo);
  for (let r: ItemRef | null = left; same(r) && r.start < hi; r = nextItem(L, r)) {
    if (r.item.kind !== "text") break;
    text += r.item.text.slice(Math.max(0, lo - r.start), Math.max(0, hi - r.start));
  }
  return { text, start };
}

/**
 * R15: an offset inside a run of text snaps to a cluster boundary of that merged text
 * (UAX #29 on the paragraph's text, as a browser segments it). Embeds are always
 * boundaries (U+FFFC never clusters with a following combining mark); neither piece
 * boundaries nor formatting changes ever are. R14 applies after this.
 */
export function graphemeFloorAt(L: ParagraphLayout, offset: number): number {
  const at = itemAt(L, offset);
  if (at === null || at.item.kind !== "text") return offset;
  // Fast paths: between two simple code units, inside one item or across an item edge.
  if (at.start < offset && simplePair(at.item.text, offset - at.start)) return offset;
  if (at.start === offset) {
    const b = itemBefore(L, offset);
    if (b === null || b.item.kind !== "text") return offset;
    // A simple code unit after an item edge starts a cluster unless the char before may
    // join it (Prepend, GB9b; ZWJ, GB11): read as the flag the scan recorded, not from the (rope) text.
    const y = at.item.text.charCodeAt(0);
    if (y >= 0x20 && y < 0x300 && !endsJoiningForward(b.item)) return offset;
  }
  const run = textRunAt(L, offset);
  if (run === null || run.start >= offset) return offset;
  return run.start + graphemeFloor(run.text, offset - run.start);
}

/** The grapheme boundary before (`dir` −1) / after (+1) boundary `offset`, in the merged text holding the unit stepped over. */
export function graphemeStepAt(L: ParagraphLayout, offset: number, dir: -1 | 1): number {
  // Fast path: the stepped-over unit and its neighbour on the far side are simple code units of one item.
  const at = itemAt(L, dir < 0 ? offset - 1 : offset);
  if (at !== null && at.item.kind === "text") {
    const local = offset - at.start;
    const t = at.item.text;
    if (dir < 0 && local >= 2 && simplePair(t, local - 1) && (local === t.length || simplePair(t, local))) return offset - 1;
    if (dir > 0 && local + 2 <= t.length && simplePair(t, local + 1) && (local === 0 || simplePair(t, local))) return offset + 1;
  }
  const run = textRunAt(L, dir < 0 ? offset - 1 : offset);
  if (run === null) return offset + dir;
  return run.start + graphemeStep(run.text, offset - run.start, dir);
}

const present = (a: ReadonlyAttrs, k: string): boolean => a[k] !== undefined && a[k] !== null;

/** Two items share an equal (non-null) value of some atomic key: one atomic unit runs across them. */
function linked(a: InlineItem, b: InlineItem, isAtomic: (key: string) => boolean): boolean {
  for (const k of Object.keys(a.attrs)) if (present(a.attrs, k) && isAtomic(k) && valueEqual(a.attrs[k], b.attrs[k])) return true;
  return false;
}

const hasAtomic = (a: InlineItem, isAtomic: (key: string) => boolean): boolean => Object.keys(a.attrs).some((k) => present(a.attrs, k) && isAtomic(k));

/**
 * R14: the atomic UNIT `offset` lies strictly inside, or null: the maximal chain of
 * items, each sharing an equal value of an atomic key with the next — the union of
 * overlapping atomic ranges. Touching ranges of different values are separate units
 * (their shared edge is a valid position). Walks items outward from `offset` only.
 */
export function atomicUnitAround(L: ParagraphLayout, offset: number, isAtomic: (key: string) => boolean): { start: number; end: number } | null {
  const at = itemAt(L, offset);
  let left: ItemRef;
  let right: ItemRef;
  if (at !== null && at.start < offset) {
    if (!hasAtomic(at.item, isAtomic)) return null;
    left = at;
    right = at;
  } else {
    const b = itemBefore(L, offset);
    if (b === null || at === null || !linked(b.item, at.item, isAtomic)) return null;
    left = b;
    right = at;
  }
  for (let p = prevItem(L, left); p !== null && linked(p.item, left.item, isAtomic); p = prevItem(L, left)) left = p;
  for (let n = nextItem(L, right); n !== null && linked(right.item, n.item, isAtomic); n = nextItem(L, right)) right = n;
  return { start: left.start, end: right.start + unitsOf(right.item) };
}

/**
 * A valid caret offset of `offset` in paragraph `L`: clamped, then R15 (into a
 * grapheme cluster of the text item → its start), R16 (offsets around a float are
 * one position, the one before the float run), then R14 (inside an atomic mark run →
 * its nearest edge, ties → end), so R14 always holds.
 */
export function resolveOffset(L: ParagraphLayout, offset: number, opts: PositionOptions = {}): number {
  let off = Number.isFinite(offset) ? Math.min(Math.max(0, Math.trunc(offset)), L.length) : 0;
  off = graphemeFloorAt(L, off);
  for (let b = itemBefore(L, off); b !== null && isFloat(b.item); b = itemBefore(L, off)) off = b.start;
  const isAtomic = opts.isAtomicMark;
  if (isAtomic !== undefined) {
    const u = atomicUnitAround(L, off, isAtomic);
    if (u !== null) off = off - u.start < u.end - off ? u.start : u.end;
  }
  return off;
}

/** `resolveOffset` for a position of `d`; null when `pos.blockId` is not a paragraph. */
export function resolvePosition(d: Document, pos: ModelPosition, opts: PositionOptions = {}): ModelPosition | null {
  const L = paragraphLayout(d, pos.blockId);
  if (L === null) return null;
  const off = resolveOffset(L, pos.offset, opts);
  return off === pos.offset ? pos : position(pos.blockId, off);
}
