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
  /**
   * The floats an INLINE box holds (floated atoms nested in it, e.g. a wrapped
   * image inside a bold span). They are not inline content: the four fields
   * above describe the box's inline content only, and the enclosing block folds
   * these in as floats (CSS 2.1 §10.3.5 shrink-to-fit). Absent when there are none.
   */
  readonly floats?: IntrinsicFloats;
}

/** The float component of an inline box's {@link IntrinsicContribution} (margin boxes). */
export interface IntrinsicFloats {
  /** Widest float min-content: each float is one unbreakable item. */
  readonly min: number;
  /** Summed max-content of the side floats on the line's inline-start side. */
  readonly startMax: number;
  /** Summed max-content of the side floats on the line's inline-end side. */
  readonly endMax: number;
  /** Widest max-content of the floats that take a line of their own (`break`). */
  readonly ownLineMax: number;
  /** The box holds nothing but floats: no inline content to start the line. */
  readonly alone: boolean;
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
