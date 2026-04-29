import type { LineBox } from "./layout-box-v2";
import type { Token } from "./ifc";

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
