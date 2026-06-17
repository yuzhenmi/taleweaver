import type { LayoutBox } from "./layout/layout-node";

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
 * A match-highlight rect snapshot for dirty-region tracking. Carries the painted
 * region (`x/y/w/h`) PLUS the `active` flag, so an active-index change on
 * next/prev — identical geometry, different fill colour — is detected as a diff
 * and repaints (the geometry-only `Rect` compare would miss it).
 */
export interface MatchHighlightRectSnapshot extends Rect {
  active: boolean;
}

/**
 * A comment-highlight rect snapshot for dirty-region tracking. Mirrors
 * `MatchHighlightRectSnapshot` EXACTLY: the painted region (`x/y/w/h`) PLUS the
 * `active` flag (the hovered/selected comment's emphasis), so an active-flag
 * change — identical geometry, different fill — is detected as a diff and
 * repaints. The `commentId` is deliberately ABSENT: it never affects pixels, so
 * it plays no part in the dirty-track diff.
 */
export interface CommentHighlightRectSnapshot extends Rect {
  active: boolean;
}

/**
 * A suggestion-highlight rect snapshot for dirty-region tracking (change-tracking
 * slice 6). Mirrors `CommentHighlightRectSnapshot` EXACTLY: the painted region
 * (`x/y/w/h`) PLUS the `active` flag (the focused suggestion's emphasis), so an
 * active-flag change — identical geometry, different fill — is detected as a diff
 * and repaints. The `suggestionId` is deliberately ABSENT: it never affects
 * pixels, so it plays no part in the dirty-track diff.
 */
export interface SuggestionHighlightRectSnapshot extends Rect {
  active: boolean;
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
  h += `|cs:${cs.backgroundColor}:${cs.color}:${cs.fontFamily}:${cs.fontSize}:${cs.fontWeight}:${cs.fontStyle}:${cs.underline}:${cs.lineThrough}`;
  h += `:${cs.borderBlockStartStyle}:${cs.borderBlockEndStyle}:${cs.borderInlineStartStyle}:${cs.borderInlineEndStyle}`;
  h += `:${cs.borderBlockStartColor}:${cs.borderBlockEndColor}:${cs.borderInlineStartColor}:${cs.borderInlineEndColor}`;
  h += `:${cs.direction}`;
  // Transform changes the painted output (paint applies it as a canvas matrix).
  // Guarded so the 99% untransformed box keeps a short hash byte-identical to
  // before this field existed. (A cs edit already changes the box ref → marks a
  // transformed box dirty via the WeakMap miss; including it here keeps the hash
  // an honest, complete record of every paint-relevant field as a backstop.)
  if (cs.transform !== undefined && cs.transform.length > 0) {
    h += `|tf:${JSON.stringify(cs.transform)}:${JSON.stringify(cs.transformOrigin)}`;
  }
  // Opacity changes the painted output (paint composites an opacity<1 box's group
  // at globalAlpha). Guarded EXACTLY like transform — append only when opacity<1
  // so the 99.99% fully-opaque box keeps a short hash byte-identical to before
  // this field existed (a missing guard would also crash partial-mock fixtures
  // whose computedStyle omits `opacity`). Same backstop rationale as transform:
  // an opacity edit already changes the box ref → WeakMap miss; the hash stays an
  // honest, complete record of every paint-relevant field.
  if (cs.opacity !== undefined && cs.opacity < 1) {
    h += `|op:${cs.opacity}`;
  }

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
  } else if (box.type === "multicolumn") {
    // A MultiColumnBox paints nothing of its own (no column-rule this slice), so
    // its OWN paint-input footprint is the column count + each column's identity
    // (position/size). The per-column subtree hashes are computed by the
    // per-box walk; here we record the column boundary so a change to the column
    // GEOMETRY (a column added/removed or repositioned) marks the container dirty
    // — mirroring how `table` records its `columnPxWidths`.
    h += `|mcols:${box.columns.length}:${box.columns.map((c) => `${c.x},${c.y},${c.width},${c.height}`).join(";")}`;
  } else if (box.type === "page") {
    h += `|page:${box.pageIndex}`;
  }

  return h;
}

/** Snapshot of the cursor's last paint inputs — used by the incremental paint
 * loop to detect cursor moves / blink-state changes that don't touch layout.
 * `null` means "no cursor painted last frame." */
export interface CursorSnapshot {
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly state: "active" | "inactive" | "hidden";
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
  /** Reset all per-box hashes and snapshots (cursor, selection, match highlights). */
  clear(): void;
  /** Get the root of the last walked tree, or null if no walk has happened. */
  getLastRoot(): LayoutBox | null;
  /** Record the root of the just-walked tree. Pass null to clear. */
  setLastRoot(root: LayoutBox | null): void;
  /** Last frame's cursor snapshot (or null on first paint). */
  getLastCursor(): CursorSnapshot | null;
  /** Record this frame's cursor snapshot. */
  setLastCursor(cursor: CursorSnapshot | null): void;
  /** Last frame's selection rects (or null on first paint). */
  getLastSelectionRects(): readonly Rect[] | null;
  /** Record this frame's selection rects. */
  setLastSelectionRects(rects: readonly Rect[] | null): void;
  /** Last frame's match-highlight rects (or null on first paint). */
  getLastMatchHighlightRects(): readonly MatchHighlightRectSnapshot[] | null;
  /** Record this frame's match-highlight rects. */
  setLastMatchHighlightRects(rects: readonly MatchHighlightRectSnapshot[] | null): void;
  /** Last frame's comment-highlight rects (or null on first paint). */
  getLastCommentHighlightRects(): readonly CommentHighlightRectSnapshot[] | null;
  /** Record this frame's comment-highlight rects. */
  setLastCommentHighlightRects(rects: readonly CommentHighlightRectSnapshot[] | null): void;
  /** Last frame's suggestion-highlight rects (or null on first paint). */
  getLastSuggestionHighlightRects(): readonly SuggestionHighlightRectSnapshot[] | null;
  /** Record this frame's suggestion-highlight rects. */
  setLastSuggestionHighlightRects(rects: readonly SuggestionHighlightRectSnapshot[] | null): void;
}

export function createPaintCache(): PaintCache {
  const map = new WeakMap<LayoutBox, PaintInputHash>();
  let lastRoot: LayoutBox | null = null;
  let lastCursor: CursorSnapshot | null = null;
  let lastSelectionRects: readonly Rect[] | null = null;
  let lastMatchHighlightRects: readonly MatchHighlightRectSnapshot[] | null = null;
  let lastCommentHighlightRects: readonly CommentHighlightRectSnapshot[] | null = null;
  let lastSuggestionHighlightRects: readonly SuggestionHighlightRectSnapshot[] | null = null;
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
      lastCursor = null;
      lastSelectionRects = null;
      lastMatchHighlightRects = null;
      lastCommentHighlightRects = null;
      lastSuggestionHighlightRects = null;
      // WeakMap entries auto-clear when keys are GC'd
    },
    getLastRoot() {
      return lastRoot;
    },
    setLastRoot(r) {
      lastRoot = r;
    },
    getLastCursor() {
      return lastCursor;
    },
    setLastCursor(c) {
      lastCursor = c;
    },
    getLastSelectionRects() {
      return lastSelectionRects;
    },
    setLastSelectionRects(r) {
      lastSelectionRects = r;
    },
    getLastMatchHighlightRects() {
      return lastMatchHighlightRects;
    },
    setLastMatchHighlightRects(r) {
      lastMatchHighlightRects = r;
    },
    getLastCommentHighlightRects() {
      return lastCommentHighlightRects;
    },
    setLastCommentHighlightRects(r) {
      lastCommentHighlightRects = r;
    },
    getLastSuggestionHighlightRects() {
      return lastSuggestionHighlightRects;
    },
    setLastSuggestionHighlightRects(r) {
      lastSuggestionHighlightRects = r;
    },
  };
}
