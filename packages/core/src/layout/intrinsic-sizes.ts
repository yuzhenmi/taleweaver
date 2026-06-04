/**
 * Intrinsic-content inline-axis sizes per CSS Sizing 3.
 *
 * `minContent` — narrowest the box can be without overflow. For inline
 *   content: widest single grapheme cluster (CJK char, unhyphenable
 *   word). For blocks: max of children's min-content.
 *
 * `maxContent` — widest the box wants given infinite space. For inline
 *   content: longest unbreakable run (a word, or a hyphenated piece if
 *   `hyphens: auto`). For blocks: max of children's max-content.
 */
export interface IntrinsicSizes {
  readonly minContent: number;
  readonly maxContent: number;
}

/**
 * Extended intrinsic contribution carried through the intrinsic-sizes pass.
 *
 * Supersets {@link IntrinsicSizes} with the two fields needed to apply
 * `text-indent` to a block's first formatted line (CSS Text §8 + CSS Sizing §5):
 *
 *  - `firstCluster` — width of the node's first grapheme cluster (0 if the node
 *    has no inline content, e.g. a block-level child; for an atomic inline-block
 *    it is the box's own min-content).
 *  - `restMin` — the node's min-content EXCLUDING that first cluster.
 *  - `minContent` — always `max(firstCluster, restMin)`.
 *
 * Stored persistently in {@link IntrinsicSizesCache} so a warm cache short-
 * circuits the whole subtree (the public `computeIntrinsicSizes` derives
 * `{minContent, maxContent}` from this at its boundary).
 */
export interface IntrinsicContribution {
  readonly minContent: number;
  readonly maxContent: number;
  readonly firstCluster: number;
  readonly restMin: number;
}

/**
 * Per-render-node cache for the intrinsic contribution. Keyed by stable
 * render-node identity (typically `node.key`). Intrinsic sizes are intrinsic to
 * the node's content + computed style, not to layout position — safe to cache
 * across layouts as long as the cache is invalidated when the node or its
 * computed style changes. The stored value is the extended
 * {@link IntrinsicContribution}; consumers that only need `{minContent,
 * maxContent}` call `computeIntrinsicSizes` rather than reading entries.
 */
export interface IntrinsicSizesCache {
  get(renderNodeKey: string): IntrinsicContribution | undefined;
  set(renderNodeKey: string, value: IntrinsicContribution): void;
  invalidate(renderNodeKey: string): void;
  clear(): void;
}

export function createIntrinsicSizesCache(): IntrinsicSizesCache {
  const map = new Map<string, IntrinsicContribution>();
  return {
    get(key) {
      return map.get(key);
    },
    set(key, value) {
      map.set(key, value);
    },
    invalidate(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}
