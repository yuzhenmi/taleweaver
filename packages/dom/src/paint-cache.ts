import type { LayoutBox } from "@taleweaver/core";

/**
 * An axis-aligned rectangle used for dirty-region tracking.
 * All values are in canvas (device-independent) pixels.
 *
 * PaintCache instances are 1:1 with paint targets (canvases / pages).
 * When Plan 5 introduces pagination (one canvas per page), each canvas
 * will carry its own PaintCache so dirty-region tracking is per-page.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A hash representing all paint-relevant inputs for a LayoutBox.
 * Two boxes with the same hash produce identical paint output.
 *
 * Inputs include: parent-relative position, size, computed-style subset
 * (color, font, decoration, border colors/styles, background, direction),
 * used-style subset (paddings, border widths), and type-specific fields
 * (text content, baseline, fragmentEdge).
 */
export type PaintInputHash = string;

/**
 * Compute a paint-input hash for a layout box.
 *
 * Two boxes with equal hashes produce the same paint output. The hash is
 * a concatenated string (not cryptographic); collision is theoretically
 * possible but unlikely for normal documents.
 */
export function hashPaintInputs(box: LayoutBox): PaintInputHash {
  // Position + size (parent-relative — see Plan 3.H Task 1)
  let h = `${box.x}:${box.y}:${box.width}:${box.height}`;

  // ComputedStyle: paint-relevant fields
  const cs = box.computedStyle;
  h += `|cs:${cs.backgroundColor}:${cs.color}:${cs.fontFamily}:${cs.fontSize}:${cs.fontWeight}:${cs.fontStyle}:${cs.textDecoration}`;
  h += `:${cs.borderBlockStartStyle}:${cs.borderBlockEndStyle}:${cs.borderInlineStartStyle}:${cs.borderInlineEndStyle}`;
  h += `:${cs.borderBlockStartColor}:${cs.borderBlockEndColor}:${cs.borderInlineStartColor}:${cs.borderInlineEndColor}`;
  h += `:${cs.direction}`;

  // UsedStyle: padding + border widths
  const us = box.usedStyle;
  h += `|us:${us.paddingBlockStart}:${us.paddingBlockEnd}:${us.paddingInlineStart}:${us.paddingInlineEnd}`;
  h += `:${us.borderBlockStartWidth}:${us.borderBlockEndWidth}:${us.borderInlineStartWidth}:${us.borderInlineEndWidth}`;

  // Type-specific fields
  if (box.type === "text-run") {
    h += `|text:${box.text}`;
  } else if (box.type === "marker") {
    h += `|marker:${box.text}`;
  } else if (box.type === "line") {
    h += `|baseline:${box.baseline}`;
  } else if (box.type === "inline") {
    h += `|fragment:${box.fragmentEdge}`;
  } else if (box.type === "table") {
    h += `|cols:${box.columnPxWidths.join(",")}`;
  }

  return h;
}

/**
 * Per-box paint-input hash cache. Keys are LayoutBox references (held in
 * a WeakMap so dropped boxes are auto-cleared). Persists across paints
 * to enable change detection.
 */
export interface PaintCache {
  get(box: LayoutBox): PaintInputHash | undefined;
  set(box: LayoutBox, hash: PaintInputHash): void;
  /** Returns true if the cached hash matches the current input hash. */
  isUnchanged(box: LayoutBox): boolean;
  /** Returns true if the cached hash matches the current input hash. */
  clear(): void;
  /** Get the root of the last walked tree, or null if no walk has happened. */
  getLastRoot(): LayoutBox | null;
  /** Record the root of the just-walked tree. Pass null to clear. */
  setLastRoot(root: LayoutBox | null): void;
}

export function createPaintCache(): PaintCache {
  const map = new WeakMap<LayoutBox, PaintInputHash>();
  let lastRoot: LayoutBox | null = null;
  return {
    get(box) {
      return map.get(box);
    },
    set(box, hash) {
      map.set(box, hash);
    },
    isUnchanged(box) {
      const cached = map.get(box);
      if (cached === undefined) return false;
      const current = hashPaintInputs(box);
      return cached === current;
    },
    clear() {
      lastRoot = null;
      // WeakMap entries auto-clear when keys are GC'd
    },
    getLastRoot() {
      return lastRoot;
    },
    setLastRoot(r) {
      lastRoot = r;
    },
  };
}
