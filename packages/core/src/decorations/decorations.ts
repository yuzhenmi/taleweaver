import type { BlockId, Position, State } from "../state";
import { recordSample } from "../perf/perf-trace";
import { createSpan, comparePositions, iterateSpan, resolveBlock } from "../state";
import type { Assoc, PositionMapping } from "../state/position-mapping";

/**
 * View-only decorations. A host computes them from document state and
 * hands them to a backend controller; they are NEVER stored in the document, the
 * undo history, the clipboard, or serialization. Backends draw them (digital: DOM
 * spans / widgets / block attributes; print: paint bands + overlays) and report
 * pointer events on them.
 *
 * Decorations are keyed by a host-chosen `id` and may carry opaque host `data`
 * (e.g. the id of a record it refers to). Taleweaver never interprets either.
 */
export type Decoration = InlineDecoration | WidgetDecoration | BlockDecoration;

/** Engine-drawn visual. Both backends draw these; `class`/`attributes` are DOM-only. */
export interface DecorationStyle {
  /** A CSS color string painted behind the range (search hit, mention highlight). */
  readonly backgroundColor?: string;
  /** An underline drawn under the range (e.g. a wavy spelling/grammar squiggle). */
  readonly underline?: {
    readonly color?: string;
    readonly style?: "solid" | "wavy" | "dotted" | "dashed";
  };
}

export interface DecorationAttrs {
  /** Engine-drawn visual — rendered by every backend. */
  readonly style?: DecorationStyle;
  /** CSS class name(s) — DOM backends only (digital; print widget overlays). */
  readonly class?: string;
  /** Extra DOM attributes (`data-*`, `aria-*`, `title`) — DOM backends only. */
  readonly attributes?: Readonly<Record<string, string>>;
}

interface DecorationBase extends DecorationAttrs {
  /** Host-chosen identity, reported back on pointer events. Unique within a set. */
  readonly id: string;
  /** Opaque host payload, reported back on pointer events. */
  readonly data?: unknown;
}

/** Styles a text range. A range spanning several blocks decorates each block's part. */
export interface InlineDecoration extends DecorationBase {
  readonly kind: "inline";
  readonly from: Position;
  readonly to: Position;
  /** Typing at the start edge extends the decoration (default false). */
  readonly inclusiveStart?: boolean;
  /** Typing at the end edge extends the decoration (default false). */
  readonly inclusiveEnd?: boolean;
}

/**
 * Inserts non-document content at a position without changing the text. Widgets occupy
 * ZERO offsets: the caret skips them and copy never includes them.
 */
export interface WidgetDecoration extends DecorationBase {
  readonly kind: "widget";
  readonly at: Position;
  /** `1` (default): the widget sits AFTER `at` (a caret at `at` is before it);
   *  `-1`: it sits BEFORE `at`. Also the mapping assoc when text is inserted at `at`. */
  readonly side?: Assoc;
  /** Text content drawn in the run's style (ghost text). Rendered by every backend. */
  readonly text?: string;
  /** Host DOM factory (DOM backends): called with the host `Document`, must return a
   *  DOM `Node`. Takes precedence over `text` where DOM is available. */
  readonly toDom?: (doc: object) => object;
}

/** Applies attributes/visuals to a whole block. */
export interface BlockDecoration extends DecorationBase {
  readonly kind: "block";
  readonly blockId: BlockId;
}

/** One block's slice of an inline decoration: offsets `[start, end)` within the block. */
export interface InlineSegment {
  readonly decoration: InlineDecoration;
  readonly start: number;
  readonly end: number;
}

/** Everything a backend needs to draw one block's decorations. */
export interface BlockDecorations {
  readonly inline: readonly InlineSegment[];
  readonly widgets: readonly WidgetDecoration[];
  readonly block: readonly BlockDecoration[];
}

const EMPTY_BLOCK: BlockDecorations = Object.freeze({
  inline: Object.freeze([]),
  widgets: Object.freeze([]),
  block: Object.freeze([]),
});

/**
 * An immutable, block-indexed set of decorations valid against one document State.
 * Build with {@link createDecorationSet}; carry through edits with
 * {@link mapDecorationSet}. Mapping re-indexes only the decorations in the transition's
 * dirty blocks, and per-block views keep reference identity for untouched blocks, so a
 * keystroke costs O(decorations in the edited blocks), not O(all decorations).
 */
export interface DecorationSet {
  /** Every decoration in the set (materialized lazily; prefer `forBlock` on hot paths). */
  readonly decorations: readonly Decoration[];
  /** The decorations to draw in `blockId` (a shared empty value when none). */
  forBlock(blockId: BlockId): BlockDecorations;
  /** Block ids that have at least one decoration. */
  blockIds(): Iterable<BlockId>;
}

export const EMPTY_DECORATION_SET: DecorationSet = Object.freeze({
  decorations: Object.freeze([]),
  forBlock: () => EMPTY_BLOCK,
  blockIds: () => [],
});

/**
 * How a set was derived, for cheap diffs: a mapped set records its base and the blocks it
 * re-indexed; a merged set records its layers.
 */
interface Provenance {
  readonly base?: DecorationSet;
  readonly touched?: ReadonlySet<BlockId>;
  readonly layers?: readonly DecorationSet[];
}
const provenance = new WeakMap<DecorationSet, Provenance>();

/** Overlay chains deeper than this are flattened (amortized O(1) per mapping). */
const MAX_OVERLAY_DEPTH = 32;

/**
 * Indexed set storage. `byBlock`/`blocksOf` hold this layer's changes; lookups miss
 * through to `base`. A `null` entry deletes the base value.
 */
interface Store {
  readonly byBlock: Map<BlockId, BlockDecorations | null>;
  /** Decoration → the blocks it is indexed in (`null` = removed relative to base). */
  readonly blocksOf: Map<Decoration, readonly BlockId[] | null>;
  readonly base: Store | null;
  readonly depth: number;
}

function storeGet(store: Store, id: BlockId): BlockDecorations {
  for (let s: Store | null = store; s !== null; s = s.base) {
    const v = s.byBlock.get(id);
    if (v !== undefined) return v ?? EMPTY_BLOCK;
  }
  return EMPTY_BLOCK;
}

function storeBlocksOf(store: Store, d: Decoration): readonly BlockId[] | null {
  for (let s: Store | null = store; s !== null; s = s.base) {
    const v = s.blocksOf.get(d);
    if (v !== undefined) return v;
  }
  return null;
}

/** Flatten a chain into one layer (insertion order of decorations preserved). */
function flatten(store: Store): Store {
  const layers: Store[] = [];
  for (let s: Store | null = store; s !== null; s = s.base) layers.unshift(s);
  const byBlock = new Map<BlockId, BlockDecorations | null>();
  const blocksOf = new Map<Decoration, readonly BlockId[] | null>();
  for (const l of layers) {
    for (const [k, v] of l.byBlock) {
      if (v === null) byBlock.delete(k);
      else byBlock.set(k, v);
    }
    for (const [k, v] of l.blocksOf) {
      if (v === null) blocksOf.delete(k);
      else blocksOf.set(k, v);
    }
  }
  return { byBlock, blocksOf, base: null, depth: 0 };
}

const stores = new WeakMap<DecorationSet, Store>();

function setFromStore(store: Store, prov?: Provenance): DecorationSet {
  let decorations: readonly Decoration[] | null = null;
  let ids: readonly BlockId[] | null = null;
  const flat = (): Store => (store.base === null ? store : flatten(store));
  const set: DecorationSet = Object.freeze({
    get decorations(): readonly Decoration[] {
      decorations ??= Object.freeze([...flat().blocksOf.keys()]);
      return decorations;
    },
    forBlock: (id: BlockId) => storeGet(store, id),
    blockIds: (): Iterable<BlockId> => {
      ids ??= Object.freeze([...flat().byBlock.keys()]);
      return ids;
    },
  });
  stores.set(set, store);
  if (prov !== undefined) provenance.set(set, prov);
  return set;
}

/**
 * Build a set against `state`. Decorations that do not resolve in `state` (unknown
 * block, offset past the end, inverted or empty inline range, endpoints in different
 * selection contexts) are dropped: a host result computed against an older document
 * must not break the editor.
 */
export function createDecorationSet(state: State, decorations: readonly Decoration[]): DecorationSet {
  if (decorations.length === 0) return EMPTY_DECORATION_SET;
  const index = new Map<BlockId, MutableBlock>();
  const blocksOf = new Map<Decoration, readonly BlockId[] | null>();
  for (const d of decorations) {
    const blocks = indexDecoration(state, d, index);
    if (blocks !== null) blocksOf.set(d, blocks);
  }
  if (blocksOf.size === 0) return EMPTY_DECORATION_SET;
  const byBlock = new Map<BlockId, BlockDecorations | null>();
  for (const [id, s] of index) byBlock.set(id, freezeBlock(s));
  return setFromStore({ byBlock, blocksOf, base: null, depth: 0 });
}

/**
 * Carry a set through one transition. Inline ranges shrink/grow with edits (edge
 * behaviour from `inclusiveStart`/`inclusiveEnd`); a decoration whose range is entirely
 * deleted disappears, as does a widget whose position is unmappable and a block
 * decoration whose block was removed. Only decorations indexed in the transition's dirty
 * blocks are re-mapped and re-indexed; everything else is reused by reference.
 */
export function mapDecorationSet(set: DecorationSet, mapping: PositionMapping, next: State): DecorationSet {
  if (mapping.identity || set === EMPTY_DECORATION_SET) return set;
  const store = stores.get(set);
  const dirty = mapping.dirty;
  if (store === undefined || dirty === null) {
    // Unknown change set (or a foreign set implementation): map everything.
    const mapped: Decoration[] = [];
    for (const d of set.decorations) {
      const m = mapDecoration(d, mapping, next);
      if (m !== null) mapped.push(m);
    }
    return createDecorationSet(next, mapped);
  }
  // Candidates: every decoration drawn in a dirty block (a multi-block inline range is
  // indexed in each block it covers, so an edit anywhere inside it is seen).
  const candidates = new Set<Decoration>();
  for (const id of dirty) {
    const b = storeGet(store, id);
    for (const s of b.inline) candidates.add(s.decoration);
    for (const w of b.widgets) candidates.add(w);
    for (const k of b.block) candidates.add(k);
  }
  if (candidates.size === 0) return set;

  const replacements: Decoration[] = [];
  for (const d of candidates) {
    const m = mapDecoration(d, mapping, next);
    if (m !== null) replacements.push(m);
  }
  return rebuild(set, store, candidates, replacements, next);
}

/**
 * Map a plain decoration list through `mapping` (e.g. a host result computed against an
 * older State, mapped by a `MappingLog`). Unmappable / collapsed decorations are dropped
 * when the result is indexed (`createDecorationSet`).
 */
export function mapDecorations(decorations: readonly Decoration[], mapping: PositionMapping, next: State): Decoration[] {
  if (mapping.identity) return [...decorations];
  const out: Decoration[] = [];
  for (const d of decorations) {
    const m = mapDecoration(d, mapping, next);
    if (m !== null) out.push(m);
  }
  return out;
}

/**
 * Replace every decoration drawn in `blocks` with `decorations` (which are indexed against
 * `state`), leaving all other blocks untouched — O(decorations in those blocks). For layers
 * a backend recomputes per block (e.g. find matches re-found in the edited blocks).
 */
export function patchDecorationSet(
  set: DecorationSet,
  state: State,
  blocks: Iterable<BlockId>,
  decorations: readonly Decoration[],
): DecorationSet {
  const store = stores.get(set);
  if (store === undefined) {
    const keep = new Set(blocks);
    const kept = set.decorations.filter((d) => !blocksOfDecoration(d).some((id) => keep.has(id)));
    return createDecorationSet(state, [...kept, ...decorations]);
  }
  const removed = new Set<Decoration>();
  for (const id of blocks) {
    const b = storeGet(store, id);
    for (const x of b.inline) removed.add(x.decoration);
    for (const w of b.widgets) removed.add(w);
    for (const k of b.block) removed.add(k);
  }
  if (removed.size === 0 && decorations.length === 0) return set;
  return rebuild(set, store, removed, decorations, state);
}

/** The blocks a decoration names directly (its endpoints). */
function blocksOfDecoration(d: Decoration): BlockId[] {
  switch (d.kind) {
    case "block":
      return [d.blockId];
    case "widget":
      return [d.at.blockId];
    case "inline":
      return [d.from.blockId, d.to.blockId];
  }
}

/** Overlay `store` with `removed` dropped and `added` indexed against `next`. */
function rebuild(
  set: DecorationSet,
  store: Store,
  removed: ReadonlySet<Decoration>,
  added: readonly Decoration[],
  next: State,
): DecorationSet {
  const touched = new Set<BlockId>();
  for (const d of removed) for (const id of storeBlocksOf(store, d) ?? []) touched.add(id);
  const index = new Map<BlockId, MutableBlock>();
  const indexed: Array<{ d: Decoration; blocks: readonly BlockId[] }> = [];
  for (const d of added) {
    const blocks = indexDecoration(next, d, index);
    if (blocks !== null) indexed.push({ d, blocks });
  }
  for (const id of index.keys()) touched.add(id);

  // Rebuild each touched block's view: survivors (not removed) + newly indexed ones.
  const byBlock = new Map<BlockId, BlockDecorations | null>();
  for (const id of touched) {
    const old = storeGet(store, id);
    const slotFor = index.get(id) ?? { inline: [], widgets: [], block: [] };
    for (const x of old.inline) if (!removed.has(x.decoration)) slotFor.inline.push(x);
    for (const w of old.widgets) if (!removed.has(w)) slotFor.widgets.push(w);
    for (const k of old.block) if (!removed.has(k)) slotFor.block.push(k);
    const fresh = freezeBlock(slotFor);
    const empty = fresh.inline.length === 0 && fresh.widgets.length === 0 && fresh.block.length === 0;
    byBlock.set(id, empty ? null : blockDecorationsEqual(old, fresh) ? old : fresh);
  }
  const blocksOf = new Map<Decoration, readonly BlockId[] | null>();
  for (const d of removed) blocksOf.set(d, null);
  for (const { d, blocks } of indexed) blocksOf.set(d, blocks);

  let nextStore: Store = { byBlock, blocksOf, base: store, depth: store.depth + 1 };
  if (nextStore.depth > MAX_OVERLAY_DEPTH) nextStore = flatten(nextStore);
  return setFromStore(nextStore, { base: set, touched });
}

/**
 * A read-only union of several sets (e.g. built-in highlight layers + host decorations),
 * drawn in argument order (later sets nest inside earlier ones). A block decorated by only
 * one layer returns that layer's per-block view by reference.
 */
export function mergeDecorationSets(sets: readonly DecorationSet[]): DecorationSet {
  const live = sets.filter((s) => s !== EMPTY_DECORATION_SET);
  if (live.length === 0) return EMPTY_DECORATION_SET;
  if (live.length === 1 && live[0] !== undefined) return live[0];
  const cache = new Map<BlockId, BlockDecorations>();
  let ids: Set<BlockId> | null = null;
  let decorations: readonly Decoration[] | null = null;
  const merged: DecorationSet = Object.freeze({
    get decorations(): readonly Decoration[] {
      decorations ??= Object.freeze(live.flatMap((s) => s.decorations));
      return decorations;
    },
    blockIds(): Iterable<BlockId> {
      if (ids === null) {
        ids = new Set();
        for (const s of live) for (const id of s.blockIds()) ids.add(id);
      }
      return ids;
    },
    forBlock(id: BlockId): BlockDecorations {
      const hit = cache.get(id);
      if (hit !== undefined) return hit;
      const parts = live.map((s) => s.forBlock(id)).filter((b) => b !== EMPTY_BLOCK);
      const out =
        parts.length === 0 ? EMPTY_BLOCK
        : parts.length === 1 && parts[0] !== undefined ? parts[0]
        : Object.freeze({
            inline: Object.freeze(parts.flatMap((p) => p.inline)),
            widgets: Object.freeze(parts.flatMap((p) => p.widgets).sort(widgetOrder)),
            block: Object.freeze(parts.flatMap((p) => p.block)),
          });
      cache.set(id, out);
      return out;
    },
  });
  provenance.set(merged, { layers: live });
  return merged;
}

/**
 * Block ids whose drawn decorations differ between `a` and `b`. Proportional to the
 * change when `b` was derived from `a` (mapped) or both are merges of such layers;
 * otherwise a full value comparison over both sets' blocks.
 */
export function changedDecorationBlocks(a: DecorationSet, b: DecorationSet): Set<BlockId> {
  const out = new Set<BlockId>();
  if (a === b) return out;
  const pb = provenance.get(b);
  if (pb?.base === a && pb.touched !== undefined) {
    for (const id of pb.touched) if (!blockDecorationsEqual(a.forBlock(id), b.forBlock(id))) out.add(id);
    return out;
  }
  const pa = provenance.get(a);
  if (pa?.layers !== undefined && pb?.layers !== undefined && pa.layers.length === pb.layers.length) {
    let fast = true;
    const candidates = new Set<BlockId>();
    pa.layers.forEach((la, i) => {
      const lb = pb.layers?.[i];
      if (lb === undefined) fast = false;
      else if (la !== lb) {
        const lp = provenance.get(lb);
        if (lp?.base === la && lp.touched !== undefined) for (const id of lp.touched) candidates.add(id);
        else fast = false;
      }
    });
    if (fast) {
      for (const id of candidates) if (!blockDecorationsEqual(a.forBlock(id), b.forBlock(id))) out.add(id);
      return out;
    }
  }
  for (const id of a.blockIds()) if (!blockDecorationsEqual(a.forBlock(id), b.forBlock(id))) out.add(id);
  for (const id of b.blockIds()) if (!blockDecorationsEqual(a.forBlock(id), b.forBlock(id))) out.add(id);
  return out;
}

/** Inline decorations covering `position` (start ≤ offset < end; a collapsed range
 *  never covers), plus widgets anchored exactly at it. For hit-testing pointer events. */
export function decorationsAt(set: DecorationSet, position: Position): Decoration[] {
  const block = set.forBlock(position.blockId);
  const out: Decoration[] = [];
  for (const seg of block.inline) {
    if (seg.start <= position.offset && position.offset < seg.end) out.push(seg.decoration);
  }
  for (const w of block.widgets) if (w.at.offset === position.offset) out.push(w);
  return out;
}

function mapDecoration(d: Decoration, mapping: PositionMapping, next: State): Decoration | null {
  recordSample("decorations.mapped", 0); // deterministic perf counter (no-op unless tracing)
  switch (d.kind) {
    case "block":
      return resolveBlock(next, d.blockId) === null ? null : d;
    case "widget": {
      const m = mapping.map(d.at, d.side ?? 1);
      if (m.position === null) return null;
      return samePosition(m.position, d.at) ? d : { ...d, at: m.position };
    }
    case "inline": {
      const from = mapping.map(d.from, d.inclusiveStart === true ? -1 : 1);
      const to = mapping.map(d.to, d.inclusiveEnd === true ? 1 : -1);
      if (from.position === null || to.position === null) return null;
      if (samePosition(from.position, d.from) && samePosition(to.position, d.to)) return d;
      return { ...d, from: from.position, to: to.position };
    }
  }
}

function samePosition(a: Position, b: Position): boolean {
  return a.blockId === b.blockId && a.offset === b.offset;
}

interface MutableBlock {
  inline: InlineSegment[];
  widgets: WidgetDecoration[];
  block: BlockDecoration[];
}

function slot(index: Map<BlockId, MutableBlock>, id: BlockId): MutableBlock {
  let s = index.get(id);
  if (s === undefined) {
    s = { inline: [], widgets: [], block: [] };
    index.set(id, s);
  }
  return s;
}

function leafLength(state: State, id: BlockId): number | null {
  const block = resolveBlock(state, id)?.block;
  if (block === undefined || block.inlineContent === null) return null;
  let n = 0;
  for (const item of block.inlineContent.items) n += item.kind === "text" ? item.text.length : 1;
  return n;
}

/** Index `d` into `index`; returns the blocks it landed in, or null when it does not
 *  resolve in `state`. */
function indexDecoration(state: State, d: Decoration, index: Map<BlockId, MutableBlock>): readonly BlockId[] | null {
  switch (d.kind) {
    case "block":
      if (resolveBlock(state, d.blockId) === null) return null;
      slot(index, d.blockId).block.push(d);
      return [d.blockId];
    case "widget": {
      const len = leafLength(state, d.at.blockId);
      if (len === null || d.at.offset < 0 || d.at.offset > len) return null;
      slot(index, d.at.blockId).widgets.push(d);
      return [d.at.blockId];
    }
    case "inline": {
      const fromLen = leafLength(state, d.from.blockId);
      const toLen = leafLength(state, d.to.blockId);
      if (fromLen === null || toLen === null) return null;
      if (d.from.offset < 0 || d.from.offset > fromLen || d.to.offset < 0 || d.to.offset > toLen) return null;
      if (d.from.blockId === d.to.blockId) {
        if (d.from.offset >= d.to.offset) return null;
        slot(index, d.from.blockId).inline.push({ decoration: d, start: d.from.offset, end: d.to.offset });
        return [d.from.blockId];
      }
      let ranges;
      try {
        if (comparePositions(state, d.from, d.to) >= 0) return null;
        ranges = [...iterateSpan(state, createSpan(d.from, d.to))];
      } catch {
        return null; // different selection contexts / unreachable — not a drawable range
      }
      const blocks: BlockId[] = [];
      for (const r of ranges) {
        if (r.rangeEnd <= r.rangeStart) continue;
        slot(index, r.block.id).inline.push({ decoration: d, start: r.rangeStart, end: r.rangeEnd });
        blocks.push(r.block.id);
      }
      return blocks.length > 0 ? blocks : null;
    }
  }
}

/** Widgets at one offset: side -1 before side 1 (stable otherwise). */
function widgetOrder(x: WidgetDecoration, y: WidgetDecoration): number {
  return x.at.offset - y.at.offset || (x.side ?? 1) - (y.side ?? 1);
}

function freezeBlock(s: MutableBlock): BlockDecorations {
  s.inline.sort((x, y) => x.start - y.start || x.end - y.end);
  s.widgets.sort(widgetOrder);
  return Object.freeze({
    inline: Object.freeze(s.inline),
    widgets: Object.freeze(s.widgets),
    block: Object.freeze(s.block),
  });
}

function blockDecorationsEqual(a: BlockDecorations, b: BlockDecorations): boolean {
  if (a === b) return true;
  if (a.inline.length !== b.inline.length || a.widgets.length !== b.widgets.length || a.block.length !== b.block.length) return false;
  for (let i = 0; i < a.inline.length; i++) {
    const x = a.inline[i];
    const y = b.inline[i];
    if (x === undefined || y === undefined || x.start !== y.start || x.end !== y.end) return false;
    if (!sameLook(x.decoration, y.decoration)) return false;
  }
  for (let i = 0; i < a.widgets.length; i++) {
    const x = a.widgets[i];
    const y = b.widgets[i];
    if (x === undefined || y === undefined || !sameLook(x, y)) return false;
    if (x.at.offset !== y.at.offset || x.side !== y.side || x.text !== y.text || x.toDom !== y.toDom) return false;
  }
  for (let i = 0; i < a.block.length; i++) {
    const x = a.block[i];
    const y = b.block[i];
    if (x === undefined || y === undefined || !sameLook(x, y)) return false;
  }
  return true;
}

/**
 * Whether two decorations DRAW the same (id + visual attrs). Value-based, so a host
 * that rebuilds an equal set every change re-draws nothing. `data` is not compared:
 * backends read it from the live set at event time, it never affects drawing.
 */
function sameLook(x: Decoration, y: Decoration): boolean {
  if (x === y) return true;
  return (
    x.id === y.id &&
    x.class === y.class &&
    x.style?.backgroundColor === y.style?.backgroundColor &&
    x.style?.underline?.color === y.style?.underline?.color &&
    x.style?.underline?.style === y.style?.underline?.style &&
    (x.style?.underline === undefined) === (y.style?.underline === undefined) &&
    recordEqual(x.attributes, y.attributes)
  );
}

function recordEqual(a: Readonly<Record<string, string>> | undefined, b: Readonly<Record<string, string>> | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}
