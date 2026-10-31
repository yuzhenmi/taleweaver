import {
  recordSample,
  asBlockId,
  createPosition,
  createSpan,
  EMPTY_DECORATION_SET,
  suggestionIdsOf,
  type BlockDecoration,
  type BlockId,
  type DecorationSet,
  type DecorationStyle,
  type InlineDecoration,
  type Position,
  type Document,
  type TextMeasurer,
  type TextShaper,
} from "@taleweaver/core";
import type { LayoutBox } from "./layout/layout-node";
import type { PixelPosition } from "./cursor/cursor-position";
import { computeSelectionRects, computeSelectionRectsForPageRange, type SelectionRect } from "./cursor/selection-geometry";
import { getLineIndex, type AbsoluteLineBox } from "./cursor/line-flatten";
import { getBoundaryMarksByBlock, type BoundaryMarkRect } from "./cursor/boundary-mark-index";

/**
 * Print geometry for core decorations. Every decoration the canvas draws — host
 * decorations AND the built-in find / comment / suggestion highlights — resolves
 * through this ONE path into `DecorationRect`s in the line-index frame of the paint
 * target (page-local for a `PageBox`, document-absolute for the single-canvas
 * tree), the same frame selection rects use.
 */

/** Underline paint geometry: a stroke along the fragment's inline axis at `offset`. */
export interface DecorationUnderlinePaint {
  /** `undefined` ⇒ the decorated run's computed text colour (CSS `currentColor`). */
  readonly color?: string;
  readonly style: "solid" | "wavy" | "dotted" | "dashed";
  /** Vertical writing mode: the stroke runs along y at x = `offset`. */
  readonly vertical: boolean;
  /** Centre of the stroke on the block axis (y for horizontal, x for vertical). */
  readonly offset: number;
}

/** One painted decoration fragment: a line slice of an inline range, or a block box. */
export interface DecorationRect extends SelectionRect {
  readonly kind: "inline" | "block";
  /** The live decoration (identity reported by pointer events). */
  readonly decoration: InlineDecoration | BlockDecoration;
  /** The fragment's inline axis is y (vertical writing mode). */
  readonly vertical: boolean;
  readonly backgroundColor?: string;
  readonly underline?: DecorationUnderlinePaint;
}

/** A fill / underline colour meaning "the decorated text's colour" (CSS
 *  `currentColor`); the painter substitutes the run's / box's computed colour. */
export const CURRENT_COLOR = "currentcolor";

/** Gap between the line baseline and an underline stroke's centre. */
const UNDERLINE_GAP = 2;
/** Half the painted extent of the thickest underline (wavy amplitude + half a stroke). */
const UNDERLINE_HALF_EXTENT = 2;

export interface DecorationGeometryInput {
  readonly document: Document;
  readonly decorations: DecorationSet;
  /** A positioned `PageBox` (paginated) or the whole positioned tree (single canvas). */
  readonly root: LayoutBox;
  /** The page `root` is, or `null` for the single-canvas tree. */
  readonly pageIndex: number | null;
  readonly measurer: TextShaper | TextMeasurer;
  /** Single canvas only: the vertical band to resolve (the viewport plus a margin);
   *  decorations wholly outside it are skipped, so cost tracks the viewport. */
  readonly band?: { readonly top: number; readonly bottom: number };
  /** Paginated only: the page range a body block occupies (`null` when unknown —
   *  e.g. a header/footer body block). A block on ONE page needs no resolution. */
  readonly pageSpanOf: (blockId: BlockId) => { readonly first: number; readonly last: number } | null;
  /** Paginated only: resolve a position against the full (virtual) tree — its
   *  `pageIndex` is what lets a block that straddles pages emit this page's part. */
  readonly resolve: (position: Position) => PixelPosition | null;
}

/**
 * Fragment cache for single-page segments: keyed by the paint target's box
 * identity (a re-laid-out page is a new box), then the decoration object and its
 * segment offsets. A host that re-sends mostly the same decoration objects — or a
 * keystroke that re-lays-out one page — re-resolves only what changed.
 */
interface CachedSegment {
  readonly start: number;
  readonly end: number;
  readonly pageIndex: number | null;
  readonly rects: readonly DecorationRect[];
}
const _segmentCache: WeakMap<LayoutBox, WeakMap<InlineDecoration, CachedSegment[]>> = new WeakMap();

/**
 * The decoration fragments to paint on `root`, bottom-to-top: block backgrounds
 * first, then inline fragments in layer order (suggestions, comments, find, host —
 * `DecorationSet.forBlock` already orders them). A page visits only the blocks with
 * boxes on it; the single canvas only the blocks with boxes inside `band`.
 */
export function computeDecorationRects(input: DecorationGeometryInput): DecorationRect[] {
  const { decorations, root, pageIndex } = input;
  if (decorations === EMPTY_DECORATION_SET) return [];
  const out: DecorationRect[] = [];
  const page = pageIndex ?? 0;
  const lineIndex = getLineIndex(root);
  // A page: every block box on it (memoized). The single canvas: only the boxes
  // inside the band (a culled walk — O(visible), never the document).
  const index = pageIndex !== null ? getBlockBoxIndex(root) : collectIndex(root, input.band ?? { top: -Infinity, bottom: Infinity });
  for (const box of index.boxes) pushBlock(out, decorations.forBlock(box.blockId).block, box, page);
  const marksByBlock = getBoundaryMarksByBlock(root);
  const seen = new Set<BlockId>();
  for (const box of index.boxes) {
    if (seen.has(box.blockId)) continue;
    seen.add(box.blockId);
    const lines = lineIndex.byBlock.get(box.blockId);
    if (lines !== undefined) pushInline(out, input, box.blockId, lines, index.rel.get(box.blockId));
    const marks = marksByBlock.get(box.blockId);
    if (marks !== undefined && marks.length > 0) pushMarks(out, input, box.blockId, marks, lines ?? [], index.rel.get(box.blockId));
  }
  return out;
}

/**
 * A suggestion decoration (the built-in highlight, a host group style) also covers
 * the tracked ¶ glyphs / section-break labels of `blockId` naming one of its
 * suggestions: a ¶ suggestion's range covers no character of the block, so the
 * glyph / label rect is the fragment — painted once under the glyph and hit by the
 * pointer (which reports the decoration, i.e. its suggestion ids, and this rect).
 */
function pushMarks(
  out: DecorationRect[],
  input: DecorationGeometryInput,
  blockId: BlockId,
  marks: readonly BoundaryMarkRect[],
  lines: readonly AbsoluteLineBox[],
  rel: RelShift | undefined,
): void {
  const done = new Set<InlineDecoration>();
  for (const seg of input.decorations.forBlock(blockId).inline) {
    const style = seg.decoration.style;
    if (done.has(seg.decoration) || (style?.backgroundColor === undefined && style?.underline === undefined)) continue;
    const ids = suggestionIdsOf(seg.decoration.data);
    if (ids.length === 0) continue;
    done.add(seg.decoration);
    for (const m of marks) {
      if (!m.box.boundaryMark.mark.suggestionIds.some((id) => ids.includes(id))) continue;
      out.push(shift(decorate(m, seg.decoration, style, lines), rel));
    }
  }
}

/** The distinct block ids with a box inside `band` on `root` (paint order) — the
 *  blocks whose decorations can be on screen in single-canvas mode. */
export function blockIdsInBand(root: LayoutBox, band: { readonly top: number; readonly bottom: number }): BlockId[] {
  return [...new Set(collectIndex(root, band).boxes.map((b) => b.blockId))];
}

function pushBlock(out: DecorationRect[], decos: readonly BlockDecoration[], box: BlockBoxRect, page: number): void {
  for (const d of decos) {
    const bg = d.style?.backgroundColor;
    if (bg === undefined) continue;
    out.push({ x: box.x, y: box.y, width: box.width, height: box.height, pageIndex: page, kind: "block", decoration: d, vertical: false, backgroundColor: bg });
  }
}

function pushInline(
  out: DecorationRect[],
  input: DecorationGeometryInput,
  blockId: BlockId,
  lines: readonly AbsoluteLineBox[],
  rel: RelShift | undefined,
): void {
  const { document, root, pageIndex, measurer } = input;
  for (const seg of input.decorations.forBlock(blockId).inline) {
    const style = seg.decoration.style;
    if (style?.backgroundColor === undefined && style?.underline === undefined) continue;
    let perRoot = _segmentCache.get(root);
    if (perRoot === undefined) {
      perRoot = new WeakMap();
      _segmentCache.set(root, perRoot);
    }
    const entries = perRoot.get(seg.decoration);
    const hit = entries?.find((c) => c.start === seg.start && c.end === seg.end && c.pageIndex === pageIndex);
    if (hit !== undefined) {
      for (const r of hit.rects) out.push(r);
      continue;
    }
    // Deterministic perf counter (no-op unless tracing): segment geometries computed
    // (cache misses) — the typing-latency gate bounds it per keystroke.
    recordSample("decorations.segmentGeometry", 0);
    const span = createSpan(createPosition(blockId, seg.start), createPosition(blockId, seg.end));
    let rects: SelectionRect[];
    let cacheable = true;
    if (pageIndex === null) {
      rects = computeSelectionRects(document, span, root, measurer);
    } else {
      const pages = input.pageSpanOf(blockId);
      if (pages !== null && pages.first === pages.last) {
        rects = computeSelectionRectsForPageRange(document, span, root, pageIndex, pages.first, pages.last, measurer);
      } else {
        // A block straddling pages (or outside the page plan): its endpoints'
        // pages depend on the whole tree, so resolve them and do not cache.
        cacheable = false;
        const startPos = input.resolve(span.anchor);
        const endPos = input.resolve(span.focus);
        if (startPos === null || endPos === null) continue;
        rects = computeSelectionRectsForPageRange(document, span, root, pageIndex, startPos.pageIndex, endPos.pageIndex, measurer);
      }
    }
    // Line geometry is the un-shifted layout frame; a `position: relative`
    // ancestor shifts the painted text, so shift the fragments the same way —
    // paint, dirty tracking and pointer hit-testing then share one frame.
    const fragments = rects.map((r) => shift(decorate(r, seg.decoration, style, lines), rel));
    for (const f of fragments) out.push(f);
    if (cacheable) {
      const entry: CachedSegment = { start: seg.start, end: seg.end, pageIndex, rects: fragments };
      if (entries !== undefined) entries.push(entry);
      else perRoot.set(seg.decoration, [entry]);
    }
  }
}

function decorate(
  r: SelectionRect,
  decoration: InlineDecoration,
  style: DecorationStyle | undefined,
  lines: readonly AbsoluteLineBox[],
): DecorationRect {
  const cy = r.y + r.height / 2;
  const cx = r.x + r.width / 2;
  const line = lines.find((l) =>
    l.line.writingMode === "horizontal-tb"
      ? l.absoluteY <= cy && cy < l.absoluteY + l.line.height
      : l.absoluteX <= cx && cx < l.absoluteX + l.line.width,
  );
  const vertical = line !== undefined ? line.line.writingMode !== "horizontal-tb" : r.height > r.width;
  const bg = style?.backgroundColor;
  const u = style?.underline;
  const base: DecorationRect = { x: r.x, y: r.y, width: r.width, height: r.height, pageIndex: r.pageIndex, kind: "inline", decoration, vertical };
  const withBg = bg !== undefined ? { ...base, backgroundColor: bg } : base;
  if (u === undefined) return withBg;
  const color = u.color;
  return {
    ...withBg,
    underline: { ...(color !== undefined ? { color } : {}), style: u.style ?? "solid", vertical, offset: underlineOffset(r, vertical, line) },
  };
}

/**
 * Where the underline stroke sits. Horizontal: just under the line's baseline.
 * Vertical: on the LINE-RIGHT (physical right) side. CSS Text Decoration 3 leaves
 * `text-underline-position: auto` to the UA and its default UA stylesheet sets
 * `right` for Japanese / Korean / Mongolian (`left` only for Chinese); browsers'
 * `auto` draws vertical underlines on the right — which is what the digital
 * backend (a plain CSS underline) shows, so print matches it.
 * Clamped so the whole stroke (incl. a wave's amplitude) stays inside the fragment.
 */
function underlineOffset(r: SelectionRect, vertical: boolean, line: AbsoluteLineBox | undefined): number {
  if (vertical) return Math.max(r.x + UNDERLINE_HALF_EXTENT, r.x + r.width - UNDERLINE_HALF_EXTENT);
  const baseline = line !== undefined ? line.absoluteY + line.line.baseline : r.y + r.height - 2 * UNDERLINE_GAP;
  const lo = r.y + UNDERLINE_HALF_EXTENT;
  const hi = r.y + r.height - UNDERLINE_HALF_EXTENT;
  return Math.max(lo, Math.min(baseline + UNDERLINE_GAP, hi));
}

function shift(r: DecorationRect, rel: RelShift | undefined): DecorationRect {
  if (rel === undefined) return r;
  const u = r.underline;
  return {
    ...r,
    x: r.x + rel.dx,
    y: r.y + rel.dy,
    ...(u !== undefined ? { underline: { ...u, offset: u.offset + (u.vertical ? rel.dx : rel.dy) } } : {}),
  };
}

// ── Block-box index ──────────────────────────────────────────────────────────

/** Cumulative `position: relative` shift of a block's painted content. */
interface RelShift {
  readonly dx: number;
  readonly dy: number;
}

interface BlockBoxIndex {
  readonly boxes: readonly BlockBoxRect[];
  /** Blocks under a `position: relative` box → their cumulative shift. */
  readonly rel: ReadonlyMap<BlockId, RelShift>;
}


interface BlockBoxRect {
  readonly blockId: BlockId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const _blockBoxIndexCache: WeakMap<LayoutBox, BlockBoxIndex> = new WeakMap();

/**
 * Every block-level box on a page (paint order), keyed by its source block id, at
 * its PAINTED position (incl. `position: relative` offsets, like the painter).
 * Memoized per page box identity (a re-laid-out page is a new box). Anonymous
 * wrappers are skipped.
 */
function getBlockBoxIndex(root: LayoutBox): BlockBoxIndex {
  const cached = _blockBoxIndexCache.get(root);
  if (cached !== undefined) return cached;
  const index = collectIndex(root, null);
  _blockBoxIndexCache.set(root, index);
  return index;
}

function collectIndex(root: LayoutBox, band: { readonly top: number; readonly bottom: number } | null): BlockBoxIndex {
  const boxes: BlockBoxRect[] = [];
  const rel = new Map<BlockId, RelShift>();
  collectBlockBoxes(root, 0, 0, 0, 0, boxes, rel, band);
  return { boxes, rel };
}

function collectBlockBoxes(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  relX: number,
  relY: number,
  out: BlockBoxRect[],
  relOut: Map<BlockId, RelShift>,
  band: { readonly top: number; readonly bottom: number } | null,
): void {
  if (box.type === "page") {
    if (box.headerSlot !== null) collectBlockBoxes(box.headerSlot, 0, 0, 0, 0, out, relOut, band);
    for (const child of box.children) collectBlockBoxes(child, 0, 0, 0, 0, out, relOut, band);
    if (box.footerSlot !== null) collectBlockBoxes(box.footerSlot, 0, 0, 0, 0, out, relOut, band);
    if (box.footnoteSlot !== null) collectBlockBoxes(box.footnoteSlot, 0, 0, 0, 0, out, relOut, band);
    return;
  }
  if (box.type === "text-run" || box.type === "marker" || box.type === "line") return;
  const r = box.relativeOffset;
  const dx = r !== undefined ? r.dx : 0;
  const dy = r !== undefined ? r.dy : 0;
  const absX = parentX + box.x + dx;
  const absY = parentY + box.y + dy;
  const rx = relX + dx;
  const ry = relY + dy;
  if (band !== null && (absY > band.bottom || absY + box.height < band.top)) return;
  if (!box.key.includes("/anon[")) {
    // A layout key IS the source block's id string (see `sourceBlockIdOf`).
    const id = asBlockId(box.key);
    out.push({ blockId: id, x: absX, y: absY, width: box.width, height: box.height });
    if (rx !== 0 || ry !== 0) relOut.set(id, { dx: rx, dy: ry });
  }
  if (box.type === "multicolumn") {
    for (const col of box.columns) collectBlockBoxes(col, absX, absY, rx, ry, out, relOut, band);
  } else if ("children" in box) {
    for (const child of box.children) collectBlockBoxes(child, absX, absY, rx, ry, out, relOut, band);
  }
  if (box.absoluteChildren !== undefined) {
    for (const abs of box.absoluteChildren) collectBlockBoxes(abs, absX, absY, rx, ry, out, relOut, band);
  }
}
