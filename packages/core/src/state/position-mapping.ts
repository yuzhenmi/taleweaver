import type { Block } from "./block";
import type { BlockId } from "./block-id";
import type { Position } from "./block-position";
import { createPosition } from "./block-position";
import type { State } from "./state";
import { peekBlock, resolveBlock } from "./state";

/**
 * Which side an ambiguous position sticks to when content is inserted exactly at it,
 * or when its surrounding content is replaced: `-1` stays before, `1` moves after.
 * Same convention as ProseMirror's `Mapping.map(pos, assoc)`.
 */
export type Assoc = -1 | 1;

export interface MappedPosition {
  /** The position in the NEXT state, or `null` when it cannot be mapped (its block's
   *  previous content is unknown to this mapping — see {@link createPositionMapping}). */
  readonly position: Position | null;
  /** True when the content on the `assoc` side of the position was deleted (or the
   *  position could not be mapped). */
  readonly deleted: boolean;
}

/**
 * Maps positions across ONE state transition (prev → next). Built by
 * {@link createPositionMapping}; composes by applying mappings in sequence.
 */
export interface PositionMapping {
  /** True when no position moves (no text changed). */
  readonly identity: boolean;
  /** The transition's dirty blocks — only positions in these can move. `null` when the
   *  change set is unknown (every position may be affected). */
  readonly dirty: ReadonlySet<BlockId> | null;
  map(position: Position, assoc?: Assoc): MappedPosition;
  /**
   * Whether the transition changed any content inside `[from, to]` (prev coordinates,
   * `from` before `to` in document order). Insertions exactly AT `from`/`to` do not count.
   * Conservative: returns true when it cannot tell.
   */
  touches(from: Position, to: Position): boolean;
}

/** The identity mapping (selection-only transitions, no-op edits). */
export const IDENTITY_MAPPING: PositionMapping = Object.freeze({
  identity: true,
  dirty: new Set<BlockId>(),
  map: (position: Position): MappedPosition => ({ position, deleted: false }),
  touches: (): boolean => false,
});

/** A mapping for a transition whose changes are unknown (e.g. the whole document was
 *  replaced): every position is unmappable. */
export const UNKNOWN_MAPPING: PositionMapping = Object.freeze({
  identity: false,
  dirty: null,
  map: (): MappedPosition => ({ position: null, deleted: true }),
  touches: (): boolean => true,
});

/** Embeds occupy one offset; they diff as this placeholder. */
const EMBED_CHAR = "￼";
/** Joins consecutive region blocks; never appears in block text. */
const SEPARATOR = "\u0000";
/** Bounded Myers: beyond this edit distance the middle is treated as one replacement. */
const MAX_DIFF_DISTANCE = 256;

interface Segment {
  readonly blockId: BlockId;
  readonly start: number; // region offset of the block's offset 0
  readonly length: number;
}

interface Hunk {
  readonly a0: number;
  readonly a1: number;
  readonly b0: number;
  readonly b1: number;
}

class UnknownBlock extends Error {}

/**
 * Build the position mapping for the transition `prev → next`, where `dirtyIds` is the
 * transition's raw dirty set (`EditorState.lastDirtyIds`, `applyOperation`'s
 * `dirtyIds`, or a foreign change's dirty set).
 *
 * The mapping is a TEXT DIFF over the dirty leaf blocks — read in document order from
 * each state and joined with a separator — so it is independent of which operation (or
 * which peer) produced the change: typing, deletes, block split/merge (text moving
 * between blocks), paste, undo/redo and collaborative updates all map the same way.
 * Formatting-only changes leave text untouched and map as identity.
 *
 * `hint` (optional) is a prev-coordinate position the edit is known to touch (e.g. the
 * prev caret); `nextHint` is the same in NEXT coordinates (the caret after the edit, which
 * every editing action leaves at the edit point — this is what disambiguates an edit that
 * is NOT at the prev caret, e.g. a programmatic delete). The common prefix and suffix stop
 * at both, so an edit next to
 * it inside repeated text resolves to the side it happened on: "aa|a" + "a" inserts at 2,
 * and Backspace in "xo|o" deletes [1, 2) rather than the trailing "o". A hint far from the
 * edit only widens the diffed middle (which Myers still resolves).
 *
 * The PREV block text is read via a cache-only peek (a superseded State's Y.Doc has
 * already been mutated). When a dirty block's previous content is not cached, positions
 * in it map to `{ position: null, deleted: true }` rather than to possibly-wrong text.
 *
 * Cost: O(total text length of the dirty leaf blocks) plus a bounded diff of the changed
 * middle — one paragraph for a keystroke.
 */
export function createPositionMapping(
  prev: State,
  next: State,
  dirtyIds: ReadonlySet<BlockId>,
  hint?: Position,
  nextHint?: Position,
): PositionMapping {
  if (prev === next || dirtyIds.size === 0) return IDENTITY_MAPPING;

  const prevGet = (id: BlockId): Block | undefined => peekBlock(prev, id);
  const nextGet = (id: BlockId): Block | undefined => resolveBlock(next, id)?.block;

  // Dirty blocks whose prev content is unknown — positions in them are unmappable.
  const unknown = new Set<BlockId>();
  const prevLeaves: Block[] = [];
  const nextLeaves: Block[] = [];
  for (const id of dirtyIds) {
    const after = nextGet(id);
    const before = prevGet(id);
    if (before !== undefined) {
      if (before.inlineContent !== null) prevLeaves.push(before);
    } else if (existedInPrev(id, after, prevGet, nextGet) !== false) {
      // Previous content unknown: leave the block out of BOTH regions (its next text alone
      // would read as a pure insertion that neighbouring positions could align into).
      unknown.add(id);
      continue;
    }
    if (after !== undefined && after.inlineContent !== null) nextLeaves.push(after);
  }

  let prevOrdered: Block[];
  try {
    prevOrdered = sortInDocOrder(prevLeaves, prevGet);
  } catch (e) {
    if (e instanceof UnknownBlock) return UNKNOWN_MAPPING;
    throw e;
  }
  const nextOrdered = sortInDocOrder(nextLeaves, nextGet);

  const a = buildRegion(prevOrdered);
  const b = buildRegion(nextOrdered);
  const aSegById = new Map(a.segments.map((s) => [s.blockId, s]));

  let hintOffset: number | undefined;
  if (hint !== undefined) {
    const seg = aSegById.get(hint.blockId);
    if (seg !== undefined) hintOffset = seg.start + Math.min(hint.offset, seg.length);
  }
  let nextHintOffset: number | undefined;
  if (nextHint !== undefined) {
    const seg = b.segments.find((g) => g.blockId === nextHint.blockId);
    if (seg !== undefined) nextHintOffset = seg.start + Math.min(nextHint.offset, seg.length);
  }
  const hunks = sameBlocks(a.segments, b.segments)
    ? perBlockHunks(a, b, hintOffset, nextHintOffset)
    : diffRegions(a.text, b.text, hintOffset, nextHintOffset);
  const identity = hunks.length === 0 && unknown.size === 0;
  if (identity) return IDENTITY_MAPPING;

  function toNext(y: number): Position | null {
    // Segments are contiguous with one separator between them, so every region
    // offset lies in exactly one [start, start + length] interval.
    for (const seg of b.segments) {
      if (y >= seg.start && y <= seg.start + seg.length) return createPosition(seg.blockId, y - seg.start);
    }
    return null;
  }

  function mapRegion(x: number, assoc: Assoc): { y: number; deleted: boolean } {
    let delta = 0;
    for (const h of hunks) {
      if (x < h.a0) break;
      const oldSize = h.a1 - h.a0;
      const newSize = h.b1 - h.b0;
      if (x <= h.a1) {
        const side = oldSize === 0 ? assoc : x === h.a0 ? -1 : x === h.a1 ? 1 : assoc;
        const deleted = oldSize > 0 && x !== (assoc < 0 ? h.a0 : h.a1);
        return { y: h.b0 + (side < 0 ? 0 : newSize), deleted };
      }
      delta += newSize - oldSize;
    }
    return { y: x + delta, deleted: false };
  }

  function map(position: Position, assoc: Assoc = 1): MappedPosition {
    if (unknown.has(position.blockId)) return { position: null, deleted: true };
    const seg = aSegById.get(position.blockId);
    if (seg === undefined) {
      // Not a dirty leaf: unchanged — unless the block itself went away.
      if (!dirtyIds.has(position.blockId)) return { position, deleted: false };
      return nextGet(position.blockId) !== undefined ? { position, deleted: false } : { position: null, deleted: true };
    }
    const { y, deleted } = mapRegion(seg.start + Math.min(position.offset, seg.length), assoc);
    const mapped = toNext(y);
    return mapped === null ? { position: null, deleted: true } : { position: mapped, deleted };
  }

  function touches(from: Position, to: Position): boolean {
    if (unknown.has(from.blockId) || unknown.has(to.blockId)) return true;
    const fromSeg = aSegById.get(from.blockId);
    const toSeg = aSegById.get(to.blockId);
    let x1: number;
    let x2: number;
    try {
      // An end outside the diffed region sits strictly BEFORE / AFTER the region's
      // nearest block boundary (−/+ 0.5): an insertion at the very start of the next
      // dirty block (or end of the previous one) is inside the range, not at its edge.
      x1 = fromSeg !== undefined ? fromSeg.start + from.offset : regionBoundaryAfter(from.blockId) - 0.5;
      x2 = toSeg !== undefined ? toSeg.start + to.offset : regionBoundaryBefore(to.blockId) + 0.5;
    } catch (e) {
      if (e instanceof UnknownBlock) return true;
      throw e;
    }
    if (x1 > x2) return false;
    for (const h of hunks) {
      if (h.a0 === h.a1 ? h.a0 > x1 && h.a0 < x2 : h.a0 < x2 && h.a1 > x1) return true;
    }
    for (const id of unknown) {
      try {
        if (between(id, from.blockId, to.blockId)) return true;
      } catch {
        return true;
      }
    }
    return false;
  }

  /** Region offset of the first dirty segment AFTER (non-region) block `id`. */
  function regionBoundaryAfter(id: BlockId): number {
    for (const seg of a.segments) {
      if (compareWith(prevGet, seg.blockId, id) > 0) return seg.start;
    }
    return a.text.length + 1;
  }
  /** Region offset of the end of the last dirty segment BEFORE (non-region) block `id`. */
  function regionBoundaryBefore(id: BlockId): number {
    let out = -1;
    for (const seg of a.segments) {
      if (compareWith(prevGet, seg.blockId, id) < 0) out = seg.start + seg.length;
    }
    return out;
  }
  function between(id: BlockId, lo: BlockId, hi: BlockId): boolean {
    return compareWith(prevGet, lo, id) <= 0 && compareWith(prevGet, id, hi) <= 0;
  }

  return { identity: false, dirty: dirtyIds, map, touches };
}

/**
 * Whether block `id` (absent from the prev cache) existed in prev. `false` = it is new
 * in next (created by this transition); `true`/`undefined` = existed / cannot tell.
 *
 * Walk back through `id`'s NEXT-state siblings over blocks that are also uncached (a run
 * of blocks created together — a multi-paragraph paste, batched splits) to the first block
 * the prev cache knows: `id` existed iff that block linked to `id` itself in prev (its old
 * `nextSiblingId`, or the parent's `firstChildId` when the run starts the parent) — new
 * blocks inserted between a known block and an existing `id` keep that old link.
 */
function existedInPrev(
  id: BlockId,
  after: Block | undefined,
  prevGet: (id: BlockId) => Block | undefined,
  nextGet: (id: BlockId) => Block | undefined,
): boolean | undefined {
  if (after === undefined) return true; // deleted by this transition ⇒ it existed
  // Walk back (next-state links) over uncached blocks to the first block prev knows.
  const walked = new Set<BlockId>([id]);
  let cur: Block = after;
  for (let guard = 0; guard < 100_000; guard++) {
    const sibId = cur.prevSiblingId;
    if (sibId === null) {
      if (cur.parentId === null) return undefined;
      const parent = prevGet(cur.parentId);
      return parent === undefined ? undefined : linkedForward(parent.firstChildId, id, walked, prevGet, nextGet);
    }
    const sib = prevGet(sibId);
    if (sib !== undefined) return linkedForward(sib.nextSiblingId, id, walked, prevGet, nextGet);
    const sibNext = nextGet(sibId);
    if (sibNext === undefined) return undefined;
    walked.add(sibId);
    cur = sibNext;
  }
  return undefined;
}

/**
 * From the known block's OLD forward link `start`, walk prev's sibling chain over blocks
 * this transition deleted (gone from next, readable in the prev cache): reaching `id` ⇒ it
 * existed; reaching a surviving block that is not one of the walked uncached blocks ⇒ the
 * walked run was inserted before it, so `id` is new; a cache miss or another walked block
 * ⇒ cannot tell.
 */
function linkedForward(
  start: BlockId | null,
  id: BlockId,
  walked: ReadonlySet<BlockId>,
  prevGet: (id: BlockId) => Block | undefined,
  nextGet: (id: BlockId) => Block | undefined,
): boolean | undefined {
  let x = start;
  for (let guard = 0; guard < 100_000; guard++) {
    if (x === null) return false; // the run was appended after the old last child
    if (x === id) return true;
    if (nextGet(x) !== undefined) return walked.has(x) ? undefined : false;
    const gone = prevGet(x);
    if (gone === undefined) return undefined;
    x = gone.nextSiblingId;
  }
  return undefined;
}

function blockText(block: Block): string {
  let out = "";
  for (const item of block.inlineContent?.items ?? []) out += item.kind === "text" ? item.text : EMBED_CHAR;
  return out;
}

function buildRegion(blocks: readonly Block[]): { text: string; segments: Segment[] } {
  const segments: Segment[] = [];
  const parts: string[] = [];
  let start = 0;
  for (const block of blocks) {
    const text = blockText(block);
    segments.push({ blockId: block.id, start, length: text.length });
    parts.push(text);
    start += text.length + SEPARATOR.length;
  }
  return { text: parts.join(SEPARATOR), segments };
}

/** Same leaf blocks, same order on both sides: no block was created, removed or moved. */
function sameBlocks(a: readonly Segment[], b: readonly Segment[]): boolean {
  return a.length === b.length && a.every((seg, i) => seg.blockId === b[i]?.blockId);
}

/**
 * When the transition kept the same blocks, text never moved between them: diff each
 * block on its own (offsetting the hunks into region coordinates). This keeps an edit
 * spread over many blocks (replace-all, a multi-paragraph undo) from exceeding the joined
 * diff's distance bound and collapsing into one hunk that would swallow the untouched
 * text between the edits. The joined diff is reserved for splits/merges/moves.
 */
function perBlockHunks(
  a: { text: string; segments: Segment[] },
  b: { text: string; segments: Segment[] },
  hint: number | undefined,
  nextHint: number | undefined,
): Hunk[] {
  const out: Hunk[] = [];
  a.segments.forEach((sa, i) => {
    const sb = b.segments[i];
    if (sb === undefined) return;
    const at = a.text.slice(sa.start, sa.start + sa.length);
    const bt = b.text.slice(sb.start, sb.start + sb.length);
    if (at === bt) return;
    const h = hint !== undefined && hint >= sa.start && hint <= sa.start + sa.length ? hint - sa.start : undefined;
    const nh = nextHint !== undefined && nextHint >= sb.start && nextHint <= sb.start + sb.length ? nextHint - sb.start : undefined;
    for (const x of diffRegions(at, bt, h, nh)) {
      out.push({ a0: x.a0 + sa.start, a1: x.a1 + sa.start, b0: x.b0 + sb.start, b1: x.b1 + sb.start });
    }
  });
  return out;
}

function ancestorChain(get: (id: BlockId) => Block | undefined, id: BlockId): BlockId[] {
  const chain: BlockId[] = [];
  let cur: BlockId | null = id;
  while (cur !== null) {
    const block = get(cur);
    if (block === undefined) throw new UnknownBlock();
    chain.push(cur);
    cur = block.parentId;
  }
  return chain;
}

/**
 * Document order of two positions in a possibly SUPERSEDED State, reading only its
 * snapshot cache (never the live Y.Doc, which may already hold a later change):
 * negative / zero / positive, or null when a needed block was never snapshotted.
 */
export function comparePositionsCached(state: State, a: Position, b: Position): number | null {
  if (a.blockId === b.blockId) return a.offset - b.offset;
  try {
    return compareWith((id) => peekBlock(state, id), a.blockId, b.blockId);
  } catch (e) {
    if (e instanceof UnknownBlock) return null;
    throw e;
  }
}

/**
 * Document-order comparison through an arbitrary block getter (so it works on a
 * superseded State via peek). Blocks in different trees order by their root id — an
 * arbitrary but consistent order, the same on both sides of a transition.
 */
function compareWith(get: (id: BlockId) => Block | undefined, a: BlockId, b: BlockId): number {
  if (a === b) return 0;
  const ca = ancestorChain(get, a);
  const cb = ancestorChain(get, b);
  let i = ca.length - 1;
  let j = cb.length - 1;
  if (ca[i] !== cb[j]) return (ca[i] ?? "") < (cb[j] ?? "") ? -1 : 1;
  while (i >= 0 && j >= 0 && ca[i] === cb[j]) {
    i--;
    j--;
  }
  if (i < 0) return -1;
  if (j < 0) return 1;
  const lca = ca[i + 1];
  const lcaBlock = lca !== undefined ? get(lca) : undefined;
  if (lcaBlock === undefined) throw new UnknownBlock();
  let cursor: BlockId | null = lcaBlock.firstChildId;
  while (cursor !== null) {
    if (cursor === ca[i]) return -1;
    if (cursor === cb[j]) return 1;
    const block = get(cursor);
    if (block === undefined) throw new UnknownBlock();
    cursor = block.nextSiblingId;
  }
  throw new UnknownBlock();
}

function sortInDocOrder(blocks: Block[], get: (id: BlockId) => Block | undefined): Block[] {
  if (blocks.length < 2) return blocks;
  return [...blocks].sort((x, y) => compareWith(get, x.id, y.id));
}

/**
 * Diff `a` → `b` into ordered hunks. Common prefix (capped at `hint`) and suffix are
 * stripped first; a non-trivial middle gets a bounded Myers diff (falling back to one
 * replacement hunk when the edit distance exceeds {@link MAX_DIFF_DISTANCE}).
 */
export function diffRegions(a: string, b: string, hint?: number, nextHint?: number): Hunk[] {
  if (a === b) return [];
  // Neither common run may cross the hint: the edit touches it.
  let suffix = 0;
  const maxSuffix = Math.min(
    a.length,
    b.length,
    hint !== undefined ? Math.max(0, a.length - hint) : Infinity,
    nextHint !== undefined ? Math.max(0, b.length - nextHint) : Infinity,
  );
  while (suffix < maxSuffix && a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)) suffix++;
  let prefix = 0;
  const maxPrefix = Math.min(a.length - suffix, b.length - suffix, hint ?? Infinity, nextHint ?? Infinity);
  while (prefix < maxPrefix && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++;
  const a1 = a.length - suffix;
  const b1 = b.length - suffix;
  if (prefix === a1 || prefix === b1) return [{ a0: prefix, a1, b0: prefix, b1 }];
  const am = a.slice(prefix, a1);
  const bm = b.slice(prefix, b1);
  // Character-level first; when the edit distance is too large (many scattered edits, e.g.
  // replace-all in one long paragraph), diff WORD tokens — far fewer edits — before falling
  // back to one replacement hunk that would swallow the untouched text between edits.
  // ponytail: both levels share MAX_DIFF_DISTANCE — past ~128 word replacements inside ONE
  // paragraph the middle still collapses to a single hunk; upgrade to a recursive
  // (patience-style) split if such paragraphs need exact mapping.
  const inner = myers(am, bm) ?? tokenDiff(am, bm);
  if (inner === null) return [{ a0: prefix, a1, b0: prefix, b1 }];
  return inner.map((h) => ({ a0: h.a0 + prefix, a1: h.a1 + prefix, b0: h.b0 + prefix, b1: h.b1 + prefix }));
}

/** Distinct tokens encodable as Private Use Area chars (U+E000..U+F8FF). */
const MAX_DISTINCT_TOKENS = 0x1900;

/** Split into runs of whitespace / non-whitespace (lossless: tokens concatenate back). */
function tokenize(s: string): string[] {
  return s.match(/\s+|\S+/g) ?? [];
}

/**
 * Word-level diff: Myers over token sequences, hunks mapped back to character offsets.
 * Equal tokens align; a changed token is replaced wholesale (fine for positions — only
 * positions INSIDE a changed word lose precision). Null past the distance bound.
 */
function tokenDiff(a: string, b: string): Hunk[] | null {
  const ta = tokenize(a);
  const tb = tokenize(b);
  // Map each distinct token to one private-use char so Myers can run on token strings.
  const codes = new Map<string, string>();
  for (const t of [...ta, ...tb]) {
    if (codes.has(t)) continue;
    if (codes.size >= MAX_DISTINCT_TOKENS) return null;
    codes.set(t, String.fromCharCode(0xe000 + codes.size));
  }
  const enc = (toks: readonly string[]): string => toks.map((t) => codes.get(t) ?? "").join("");
  const ea = enc(ta);
  const eb = enc(tb);
  const hunks = myers(ea, eb);
  if (hunks === null) return null;
  const offsetsA = prefixOffsets(ta);
  const offsetsB = prefixOffsets(tb);
  return hunks.map((h) => ({
    a0: offsetsA[h.a0] ?? a.length,
    a1: offsetsA[h.a1] ?? a.length,
    b0: offsetsB[h.b0] ?? b.length,
    b1: offsetsB[h.b1] ?? b.length,
  }));
}

/** offsets[i] = character offset where token i starts (offsets[n] = total length). */
function prefixOffsets(tokens: readonly string[]): number[] {
  const out = [0];
  let acc = 0;
  for (const t of tokens) {
    acc += t.length;
    out.push(acc);
  }
  return out;
}

/** Myers O(ND) diff → merged change hunks, or null past the distance bound. */
function myers(a: string, b: string): Hunk[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_DIFF_DISTANCE);
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[k - 1 + offset] ?? 0) < (v[k + 1 + offset] ?? 0))) x = v[k + 1 + offset] ?? 0;
      else x = (v[k - 1 + offset] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a.charCodeAt(x) === b.charCodeAt(y)) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) return backtrack(trace, v, offset, n, m, d);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], last: Int32Array, offset: number, n: number, m: number, dEnd: number): Hunk[] {
  // Walk the trace back to collect (x, y) snake starts, then emit maximal change hunks.
  const edits: Array<{ kind: "del" | "ins"; x: number; y: number }> = [];
  let x = n;
  let y = m;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d] ?? last;
    const k = x - y;
    const down = k === -d || (k !== d && (v[k - 1 + offset] ?? 0) < (v[k + 1 + offset] ?? 0));
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[prevK + offset] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX + (down ? 0 : 1) && y > prevY + (down ? 1 : 0)) {
      x--;
      y--;
    }
    if (down) edits.push({ kind: "ins", x: prevX, y: prevY });
    else edits.push({ kind: "del", x: prevX, y: prevY });
    x = prevX;
    y = prevY;
  }
  edits.reverse();
  const hunks: Hunk[] = [];
  for (const e of edits) {
    const a0 = e.x;
    const b0 = e.y;
    const a1 = e.kind === "del" ? e.x + 1 : e.x;
    const b1 = e.kind === "ins" ? e.y + 1 : e.y;
    const lastHunk = hunks[hunks.length - 1];
    if (lastHunk !== undefined && lastHunk.a1 === a0 && lastHunk.b1 === b0) {
      hunks[hunks.length - 1] = { a0: lastHunk.a0, a1, b0: lastHunk.b0, b1 };
    } else {
      hunks.push({ a0, a1, b0, b1 });
    }
  }
  return hunks;
}
