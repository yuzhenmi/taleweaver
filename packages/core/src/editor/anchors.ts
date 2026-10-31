import { extractText, createSpan, positionsEqual, comparePositions, resolveBlock, iterateSpan } from "../state";
import { recordSample } from "../perf/perf-trace";
import type { BlockId, Position, Document } from "../state";
import type { Assoc, MappedPosition, PositionMapping } from "../state/position-mapping";
import type { MappingLog } from "./mapping-log";

/**
 * Anchors: host-held positions / ranges that stay correct through every later edit —
 * local typing, block split / merge, paste, undo / redo, replace-all and foreign
 * (collaborative) changes — because they are carried by the same text-diff
 * `PositionMapping` the decorations use. A host computing something asynchronously
 * anchors its input, and when the result arrives reads where it now is, or learns that
 * the text was deleted / changed meanwhile and discards the result.
 */

export interface AnchorOptions {
  /**
   * Range only: insertions exactly at an edge join the range (default false — the range
   * keeps its content; text typed at its edges stays outside).
   */
  readonly inclusive?: boolean;
  /** Point only: which side the point sticks to on an insertion at it (default 1 = after). */
  readonly assoc?: Assoc;
}

export interface Anchor {
  /** Current start (the point for a point anchor). Last known value once `deleted`. */
  readonly from: Position;
  /** Current end (equals `from` for a point anchor). */
  readonly to: Position;
  /** The anchored content no longer exists (an edge's content deleted / unmappable). */
  readonly deleted: boolean;
  /** The range's text differs from its text at creation (or `deleted`). */
  readonly changed: boolean;
  readonly disposed: boolean;
  /** Stop tracking (frees it from the set). */
  dispose(): void;
}

export interface AnchorSet {
  /** Track `[from, to]` (or the point `from`) in `document`, the controller's current document. */
  create(document: Document, from: Position, to?: Position, options?: AnchorOptions): Anchor;
  /**
   * Like `create`, but `from` / `to` are positions in an OLDER document `version`: they are
   * mapped to `current` through `log` first. Null when that version is no longer
   * mappable (aged out of the log) or the content is already gone; the anchor starts
   * `changed` when the range was edited since that version.
   */
  createAt(
    log: MappingLog,
    current: Document,
    version: Document,
    from: Position,
    to?: Position,
    options?: AnchorOptions,
  ): Anchor | null;
  /** Carry every live anchor through one document transition. */
  advance(prev: Document, next: Document, mapping: PositionMapping): void;
  /** Live anchor count. */
  readonly size: number;
}

class AnchorImpl implements Anchor {
  from: Position;
  to: Position;
  /** The leaf blocks the anchor is indexed under (every block its span covers) — a Set
   *  so the per-edit "did the edit touch a block outside the index?" check is O(1) per
   *  dirty block, never O(span). */
  indexed: ReadonlySet<BlockId> = new Set();
  deleted = false;
  changed = false;
  disposed = false;
  constructor(
    readonly point: boolean,
    from: Position,
    to: Position,
    readonly fromAssoc: Assoc,
    readonly toAssoc: Assoc,
    readonly text: string,
    private readonly onDispose: (a: AnchorImpl) => void,
  ) {
    this.from = from;
    this.to = to;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onDispose(this);
  }
}

/** The anchored text (empty for a point / an unreadable span). */
function rangeText(document: Document, from: Position, to: Position): string {
  if (positionsEqual(from, to)) return "";
  try {
    return extractText(document, createSpan(from, to));
  } catch {
    return "";
  }
}

/**
 * Snapshot the anchor's blocks in the CURRENT state. The mapping of the next
 * transition reads the previous snapshot of every dirty block (cache-only: the Y.Doc
 * has already changed by then); a block never read since its last change would be
 * "cold" and map as unknown. Keeping anchored blocks warm means even a foreign
 * change to an off-screen anchored paragraph maps exactly.
 */
function warm(document: Document, a: { from: Position; to: Position }): void {
  resolveBlock(document, a.from.blockId);
  if (a.to.blockId !== a.from.blockId) resolveBlock(document, a.to.blockId);
}

export function createAnchorSet(): AnchorSet {
  // Every anchor is indexed under EVERY leaf block its span covers (a point / single-
  // block range: its block), so a transition visits only the anchors under its dirty
  // blocks — an edit in a middle paragraph of a multi-block range still reaches it, and
  // a keystroke elsewhere costs nothing.
  const byBlock = new Map<BlockId, Set<AnchorImpl>>();
  let size = 0;

  /** The leaf blocks `a`'s span covers in `document` (O(span); only on creation / structural change). */
  const covered = (document: Document, a: AnchorImpl): BlockId[] => {
    if (a.from.blockId === a.to.blockId) return [a.from.blockId];
    try {
      return [...iterateSpan(document, createSpan(a.from, a.to))].map((seg) => seg.block.id);
    } catch {
      return [a.from.blockId, a.to.blockId];
    }
  };
  const index = (a: AnchorImpl, blocks: readonly BlockId[]): void => {
    recordSample("anchors.reindexed", 0); // deterministic perf counter (no-op unless tracing)
    a.indexed = new Set(blocks);
    for (const id of blocks) {
      let set = byBlock.get(id);
      if (set === undefined) byBlock.set(id, (set = new Set()));
      set.add(a);
    }
  };
  const unindex = (a: AnchorImpl): void => {
    for (const id of a.indexed) {
      const set = byBlock.get(id);
      if (set === undefined) continue;
      set.delete(a);
      if (set.size === 0) byBlock.delete(id);
    }
    a.indexed = new Set();
  };
  const drop = (a: AnchorImpl): void => {
    unindex(a);
    size--;
  };

  function remap(a: AnchorImpl, next: Document, mapping: PositionMapping): void {
    const wasEmpty = positionsEqual(a.from, a.to);
    const f = mapping.map(a.from, a.fromAssoc);
    const t = a.point ? f : mapping.map(a.to, a.toAssoc);
    // A point is deleted only when the content on BOTH of its sides went (map's
    // `deleted` reports the assoc side only): deleting just the next character keeps it.
    const pointGone = a.point && f.deleted && mapping.map(a.from, a.fromAssoc === 1 ? -1 : 1).deleted;
    if (f.position === null || t.position === null || pointGone) {
      a.deleted = true;
      a.changed = true;
      return;
    }
    const touched = !a.point && mapping.touches(a.from, a.to);
    a.from = f.position;
    a.to = t.position;
    if (!a.point && comparePositions(next, a.from, a.to) > 0) a.to = a.from; // never inverted
    if (!a.point && !wasEmpty && positionsEqual(a.from, a.to)) {
      a.deleted = true; // all of the range's content was removed
      a.changed = true;
      return;
    }
    if (touched && !a.changed) a.changed = rangeText(next, a.from, a.to) !== a.text;
  }

  function make(document: Document, from: Position, to?: Position, options: AnchorOptions = {}): AnchorImpl {
    const point = to === undefined;
    const end = to ?? from;
    const [start, stop] = !point && comparePositions(document, end, from) < 0 ? [end, from] : [from, end];
    const inclusive = options.inclusive === true;
    const a = new AnchorImpl(
      point,
      start,
      stop,
      point ? (options.assoc ?? 1) : inclusive ? -1 : 1,
      point ? (options.assoc ?? 1) : inclusive ? 1 : -1,
      point ? "" : rangeText(document, start, stop),
      (x) => {
        if (!x.deleted) drop(x);
      },
    );
    index(a, covered(document, a));
    warm(document, a);
    size++;
    return a;
  }

  return {
    get size() {
      return size;
    },
    createAt(log, current, version, from, to, options = {}) {
      if (version === current) return make(current, from, to, options);
      const mapping = log.mappingFrom(version);
      if (mapping === null) return null;
      const inclusive = options.inclusive === true;
      if (to === undefined) {
        const assoc = options.assoc ?? 1;
        const r = mapping.map(from, assoc);
        const gone = r.deleted && mapping.map(from, assoc === 1 ? -1 : 1).deleted; // both sides
        return r.position === null || gone ? null : make(current, r.position, undefined, options);
      }
      const f = mapping.map(from, inclusive ? -1 : 1).position;
      const t = mapping.map(to, inclusive ? 1 : -1).position;
      if (f === null || t === null) return null;
      if (!positionsEqual(from, to) && positionsEqual(f, t)) return null; // content removed
      const anchor = make(current, f, t, options);
      // The text at `version` cannot be re-read (that Document's Y.Doc has moved on), so an
      // edit inside the range since then marks the anchor changed outright.
      if (mapping.touches(from, to)) anchor.changed = true;
      return anchor;
    },
    create: make,
    advance(_prev, next, mapping) {
      if (mapping.identity || size === 0) return;
      const visit = new Set<AnchorImpl>();
      if (mapping.dirty === null) for (const set of byBlock.values()) for (const a of set) visit.add(a);
      else for (const id of mapping.dirty) for (const a of byBlock.get(id) ?? []) visit.add(a);
      for (const a of visit) {
        recordSample("anchors.remapped", 0); // deterministic perf counter (no-op unless tracing)
        const from = a.from;
        const to = a.to;
        const blocks = a.indexed;
        remap(a, next, mapping);
        // A deleted anchor is final: it leaves the index (nothing left to map).
        if (a.deleted) {
          unindex(a);
          size--;
          continue;
        }
        // Re-index only when the span may cover different blocks: an end moved to another
        // block, or the
        // transition touched a block it is not indexed under (a block inserted / removed
        // inside it). A plain edit inside a covered block keeps the index (O(1)).
        let structural = mapping.dirty === null;
        if (!structural && mapping.dirty !== null) {
          for (const id of mapping.dirty) {
            if (!blocks.has(id)) {
              structural = true;
              break;
            }
          }
        }
        if (from.blockId !== a.from.blockId || to.blockId !== a.to.blockId || structural) {
          unindex(a);
          index(a, covered(next, a));
        }
        warm(next, a);
      }
    },
  };
}

/**
 * Map `position` from an older document `version` to `current` through `log`:
 * `{ position, deleted }` (as `PositionMapping.map`), or null when the version has aged
 * out of the bounded log (or precedes a document replacement) — the host must then
 * treat its result as stale.
 */
export function mapPositionFrom(
  log: MappingLog,
  current: Document,
  version: Document,
  position: Position,
  assoc: Assoc = 1,
): MappedPosition | null {
  if (version === current) return { position, deleted: false };
  const mapping = log.mappingFrom(version);
  return mapping === null ? null : mapping.map(position, assoc);
}
