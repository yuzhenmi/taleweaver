import type { LineBox } from "./layout-box";
import type { Token } from "./ifc";
import type { TextAlign, TabStop } from "@taleweaver/core";
import type { Direction } from "@taleweaver/core";

/**
 * Snapshot of an IFC's wrap output for one paragraph (or anonymous block run).
 * Cached per `paragraph.key` for incremental re-wrap (Plan 3.G Task 3).
 *
 * On a subsequent layout, we compare the new tokens against `state.tokens`
 * to find the change point; lines unaffected by the change can be reused
 * by reference.
 */
export interface IFCState {
  readonly tokens: readonly Token[];
  readonly lines: readonly LineBox[];
  readonly availableInlineSize: number;
  /**
   * The block's resolved `textAlign` + inline base `direction` at the time the
   * lines were laid out. The cached lines bake in their alignment offset (each
   * LineBox's `inlineOffset`/`x` already reflects the aligned position), so a
   * subsequent layout that changed ONLY the alignment must NOT reuse them. The
   * cache-hit gate compares these in addition to tokens + availableInlineSize.
   */
  readonly textAlign: TextAlign;
  readonly direction: Direction;
  /**
   * The block's resolved `text-indent` (used length, px) at layout time. The
   * FIRST cached line bakes in the indent (its inline-start cursor + width
   * reflect it), so a subsequent layout that changed ONLY the indent — same
   * tokens, width, align, direction — must NOT reuse the stale lines. Same
   * rationale as `textAlign`/`direction` above.
   */
  readonly textIndent: number;
  /**
   * The block's resolved tab-stop list + default interval at layout time. Tab
   * glyphs advance to these stops, so the cached lines bake in the stop
   * geometry — a stop-list or default-interval change (same tokens/width/align/
   * indent) must NOT reuse them. The cache-hit gate compares these.
   */
  readonly tabStops: readonly TabStop[];
  readonly defaultTabStop: number;
  /**
   * Whether this paragraph contains at least one tab. A tab's advance depends on
   * its position WITHIN the line (the cursor when it is reached), so a cached
   * entry with a tab cannot be reused by the cheap incremental-wrap fast path —
   * the fragmentation-gate seam treats `hasTab: true` as a cache miss. Set at
   * cache-save time from `tokens.some((t) => t.isTab === true)`.
   */
  readonly hasTab: boolean;
}

/**
 * Per-paragraph cache for `IFCState`. Keyed by the paragraph's render-node key.
 */
export interface IFCStateCache {
  get(paragraphKey: string): IFCState | undefined;
  set(paragraphKey: string, state: IFCState): void;
  invalidate(paragraphKey: string): void;
  clear(): void;
}

export function createIFCStateCache(): IFCStateCache {
  const map = new Map<string, IFCState>();
  return {
    get(key) {
      return map.get(key);
    },
    set(key, state) {
      map.set(key, state);
    },
    invalidate(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}
