import type { EditorAction } from "./editor-action";
import type { BlockId, Position, Document, TextMatch, FindMatchesOptions } from "../state";
import { comparePositions, createPosition, findMatches, getBlock, selectionContextOf } from "../state";
import type { PositionMapping } from "../state/position-mapping";

/** "n of N" for a find UI: `activeIndex` is -1 when there is no active match. */
export interface FindStatus {
  readonly total: number;
  readonly activeIndex: number;
}

const NO_MATCH: FindStatus = Object.freeze({ total: 0, activeIndex: -1 });

/** What a refresh changed: the blocks whose matches (or active flag) must be redrawn, or
 *  `null` when everything may have changed. */
export interface FindRefresh {
  readonly status: FindStatus;
  readonly changedBlocks: ReadonlySet<BlockId> | null;
}

/**
 * A geometry-free find / replace session (Ctrl+F) shared by every backend: the backend
 * draws `matches()` / `activeIndex()` (as find-highlight decorations) and scrolls the active
 * match into view; the session owns the query, the match list and navigation.
 *
 * - `start` finds from the caret: the first match at/after it is active (Google Docs).
 * - `refresh(state, mapping)` follows a document change: with the transition's mapping it
 *   re-finds only in the changed blocks and keeps the ACTIVE OCCURRENCE (mapped through the
 *   edit); right after a replace it moves to the first match after the replacement text, so
 *   a replacement containing the query cannot trap Replace on the same spot.
 * - `replaceActiveAction` / `replaceAllAction` return the engine action to dispatch
 *   (REPLACE_MATCH / REPLACE_ALL — one undo step each).
 */
export interface FindSession {
  readonly active: boolean;
  start(document: Document, caret: Position, query: string, options?: FindMatchesOptions): FindStatus;
  next(): FindStatus;
  prev(): FindStatus;
  close(): void;
  refresh(document: Document, mapping?: PositionMapping): FindRefresh;
  status(): FindStatus;
  matches(): readonly TextMatch[];
  activeIndex(): number;
  replaceActiveAction(replacement: string): EditorAction | null;
  replaceAllAction(replacement: string): EditorAction | null;
}

export function createFindSession(): FindSession {
  let query: { text: string; options: FindMatchesOptions } | null = null;
  let matches: TextMatch[] = [];
  let active = -1;
  /** Set by `replaceActiveAction`: the next refresh activates the first match after it. */
  let pendingReplace: { at: Position; length: number } | null = null;

  const status = (): FindStatus => (matches.length === 0 ? NO_MATCH : { total: matches.length, activeIndex: active });

  function compare(document: Document, a: Position, b: Position): number | null {
    if (a.blockId === b.blockId) return a.offset - b.offset;
    try {
      if (selectionContextOf(document, a.blockId) !== selectionContextOf(document, b.blockId)) return null;
      return comparePositions(document, a, b);
    } catch {
      return null;
    }
  }

  /** Index of the first match starting at/after `pos` (wrapping to 0); matches in another
   *  selection context never count as "after". Binary search over the doc-ordered list. */
  function firstAtOrAfter(document: Document, pos: Position): number {
    let lo = 0;
    let hi = matches.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = matches[mid];
      const c = m === undefined ? null : compare(document, createPosition(m.blockId, m.start), pos);
      if (c === null) {
        // Unordered against `pos`: fall back to a linear scan.
        for (let i = 0; i < matches.length; i++) {
          const x = matches[i];
          if (x !== undefined && (compare(document, createPosition(x.blockId, x.start), pos) ?? -1) >= 0) return i;
        }
        return 0;
      }
      if (c >= 0) hi = mid;
      else lo = mid + 1;
    }
    return lo < matches.length ? lo : 0;
  }

  /**
   * Re-find only in `dirty` blocks: drop the old matches of those blocks, find again in the
   * surviving leaves among them, and splice the results back in document order.
   */
  function refreshBlocks(document: Document, dirty: ReadonlySet<BlockId>): Set<BlockId> | null {
    if (query === null) return new Set();
    const changed = new Set<BlockId>();
    for (const m of matches) if (dirty.has(m.blockId)) changed.add(m.blockId);
    const kept = matches.filter((m) => !dirty.has(m.blockId));
    const leaves: BlockId[] = [];
    for (const id of dirty) if (getBlock(document, id)?.inlineContent != null) leaves.push(id);
    const found = leaves.length === 0 ? [] : findMatches(document, query.text, { ...query.options, blockIds: leaves });
    for (const m of found) changed.add(m.blockId);
    // Merge: `kept` is in doc order; insert each found block's run at its position.
    const byBlock = new Map<BlockId, TextMatch[]>();
    for (const m of found) {
      const run = byBlock.get(m.blockId);
      if (run === undefined) byBlock.set(m.blockId, [m]);
      else run.push(m);
    }
    let merged = kept;
    for (const [blockId, run] of byBlock) {
      const first = run[0];
      if (first === undefined) continue;
      const pos = createPosition(blockId, first.start);
      let lo = 0;
      let hi = merged.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const m = merged[mid];
        const c = m === undefined ? null : compare(document, createPosition(m.blockId, m.start), pos);
        if (c === null) return null; // cannot order → caller re-finds everything
        if (c < 0) lo = mid + 1;
        else hi = mid;
      }
      merged = [...merged.slice(0, lo), ...run, ...merged.slice(lo)];
    }
    matches = merged;
    return changed;
  }

  return {
    get active() {
      return query !== null;
    },
    start(document, caret, text, options) {
      query = { text, options: options ?? { caseSensitive: false, wholeWord: false } };
      matches = findMatches(document, text, query.options);
      pendingReplace = null;
      active = matches.length === 0 ? -1 : firstAtOrAfter(document, caret);
      return status();
    },
    next() {
      if (matches.length === 0) return NO_MATCH;
      active = (active + 1) % matches.length;
      return status();
    },
    prev() {
      if (matches.length === 0) return NO_MATCH;
      active = (active - 1 + matches.length) % matches.length;
      return status();
    },
    close() {
      query = null;
      matches = [];
      active = -1;
      pendingReplace = null;
    },
    refresh(document, mapping) {
      if (query === null) return { status: NO_MATCH, changedBlocks: new Set() };
      const prevActive = matches[active];
      // Where the active match should land: past a just-applied replacement, else the
      // active occurrence mapped through the edit.
      let target: Position | null = null;
      const replaced = pendingReplace;
      pendingReplace = null;
      if (mapping !== undefined) {
        if (replaced !== null) {
          const p = mapping.map(replaced.at, -1).position;
          target = p === null ? null : createPosition(p.blockId, p.offset + replaced.length);
        } else if (prevActive !== undefined) {
          target = mapping.map(createPosition(prevActive.blockId, prevActive.start), -1).position;
        }
      }
      let changed: Set<BlockId> | null = null;
      if (mapping !== undefined && mapping.dirty !== null) changed = refreshBlocks(document, mapping.dirty);
      if (changed === null) matches = findMatches(document, query.text, query.options);
      if (matches.length === 0) active = -1;
      else if (target !== null) active = firstAtOrAfter(document, target);
      else active = Math.min(Math.max(active, 0), matches.length - 1);
      // The active flag moved: its old and new blocks redraw too.
      const nowActive = matches[active];
      if (changed !== null) {
        if (prevActive !== undefined) changed.add(prevActive.blockId);
        if (nowActive !== undefined) changed.add(nowActive.blockId);
      }
      return { status: status(), changedBlocks: changed };
    },
    status,
    matches: () => matches,
    activeIndex: () => active,
    replaceActiveAction(replacement) {
      const m = matches[active];
      if (m === undefined) return null;
      pendingReplace = { at: createPosition(m.blockId, m.start), length: replacement.length };
      return { type: "REPLACE_MATCH", match: m, replacement };
    },
    replaceAllAction(replacement) {
      return matches.length === 0 ? null : { type: "REPLACE_ALL", matches: [...matches], replacement };
    },
  };
}
