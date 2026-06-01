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
 * Per-render-node cache for IntrinsicSizes. Keyed by stable render-node
 * identity (typically `node.key`). Intrinsic sizes are intrinsic to the
 * node's content + computed style, not to layout position — safe to cache
 * across layouts as long as the cache is invalidated when the node or its
 * computed style changes.
 */
export interface IntrinsicSizesCache {
  get(renderNodeKey: string): IntrinsicSizes | undefined;
  set(renderNodeKey: string, value: IntrinsicSizes): void;
  invalidate(renderNodeKey: string): void;
  clear(): void;
}

export function createIntrinsicSizesCache(): IntrinsicSizesCache {
  const map = new Map<string, IntrinsicSizes>();
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
