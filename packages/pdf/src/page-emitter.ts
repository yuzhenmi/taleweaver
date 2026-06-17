import type { PageBox, LayoutBox } from "@taleweaver/print";
import { sourceBlockIdOf, markerOwnerKey } from "@taleweaver/print";
import { physicalBorderSides, isOpenableLinkUrl } from "@taleweaver/core";
import { ContentStreamBuilder } from "./content-stream";
import { pointYUp, rectYUp, PX_TO_PT } from "./coordinate";
import { parseCssColor, BLACK } from "./color";
import type { PdfFontProvider, PdfFontHandle } from "./font-provider";
import type { PdfImageProvider, PdfImageHandle } from "./image-provider";

export interface PageEmitDeps {
  readonly provider: PdfFontProvider;
  /** Map a provider `fontKey` to its stable `/Fn` resource name. */
  readonly fontResourceName: (fontKey: string) => string;
  /** Resolves layout image `src`s to embeddable handles. Absent ⇒ every image
   *  draws a grey placeholder (mirrors the canvas renderer's not-cached branch). */
  readonly imageProvider?: PdfImageProvider;
  /** Map a resolved image `imageKey` to its stable `/Imn` resource name. */
  readonly imageResourceName: (imageKey: string) => string;
  /**
   * The set of block ids that are tagged structure leaves (#526 tagged PDF). When
   * present, body-region content owned by a member id is wrapped in a marked-content
   * `/Span <</MCID n>> BDC … EMC` sequence and recorded in `PageEmitResult.structRefs`;
   * header/footer-region content is wrapped in `/Artifact … EMC` (excluded from the
   * structure tree). ABSENT (undefined) ⇒ NO tagging at all: every begin/end call is
   * skipped and the content stream is byte-identical to the untagged baseline.
   */
  readonly structureBlockIds?: ReadonlySet<string>;
}

/** Which page region a box belongs to. Body content is taggable (MCID); header
 *  and footer content is an artifact (excluded from the structure tree); footnote
 *  bodies are body-class taggable content. */
type EmitRegion = "body" | "header" | "footer" | "footnote";

/** A per-page MCID allocator, threaded by reference through the walk so each
 *  tagged leaf gets a unique, monotonically increasing MCID starting at 0. */
interface McidCounter {
  next: number;
}

/** One emitted marked-content correlation: a structure leaf's block id, the MCID
 *  the leaf was wrapped with, and whether the leaf is a list/footnote MARKER
 *  (routed to the structure element's `Lbl`) vs the block's own content. */
interface StructRef {
  readonly blockId: string;
  readonly mcid: number;
  readonly isMarker: boolean;
}

export interface PageEmitResult {
  readonly contentBytes: Uint8Array;
  /** Handles that actually emitted glyphs, in first-encountered order, deduped
   *  by `fontKey`. Drives which font objects the caller writes + references. */
  readonly usedHandles: readonly PdfFontHandle[];
  /** Image handles actually placed on this page, in first-encountered order,
   *  deduped by `imageKey`. Drives which XObjects the caller writes + references. */
  readonly usedImages: readonly PdfImageHandle[];
  /** One entry per linked text-run on this page: the safe URL + its PDF /Rect
   *  `[llx lly urx ury]` in points (converted from rectYUp's `[x, yBottom, w, h]`
   *  by `[lx, ly, lx+lw, ly+lh]`). Empty when the page has no live links. */
  readonly linkRects: readonly { readonly url: string; readonly rect: readonly [number, number, number, number] }[];
  /** One entry per internal-destination link on this page: the target block id
   *  + its PDF /Rect `[llx lly urx ury]` in points. Sources: TOC entry containers
   *  (`BlockBox.metadata.navTarget`, whole-line click) and cross-ref atoms
   *  (`InlineBlockBox.targetId`). A cross-ref atom inside a TOC entry container is
   *  de-duped out (the container's whole-line link wins). Empty when the page has
   *  no internal links. Resolution to a concrete page/coords happens in emit-pdf
   *  (which holds the injected resolver). */
  readonly internalLinkRects: readonly { readonly targetId: string; readonly rect: readonly [number, number, number, number] }[];
  /** One entry per marked-content sequence emitted on this page (#526 tagged PDF):
   *  the owning structure-leaf `blockId`, the `mcid` it was wrapped with, and
   *  whether the leaf is a list/footnote MARKER (`Lbl`) vs the block's own content.
   *  Drives the caller's `/StructTreeRoot` ParentTree + element construction.
   *  ALWAYS present; EMPTY when `PageEmitDeps.structureBlockIds` is absent (untagged). */
  readonly structRefs: readonly StructRef[];
}

type TextLeafBox = Extract<LayoutBox, { type: "text-run" | "marker" }>;

/**
 * The page content is emitted in two passes, mirroring the canvas renderer's
 * `paintBox` (called twice). The BACKGROUND pass paints box backgrounds,
 * borders and rules UNDER the text; the FOREGROUND pass emits text/marker
 * glyphs. Running background-first guarantees future graphics sit beneath text.
 */
type EmitPhase = "background" | "foreground";

function isTextLeaf(box: LayoutBox): box is TextLeafBox {
  return box.type === "text-run" || box.type === "marker";
}

function hasChildren(box: LayoutBox): box is LayoutBox & { children: readonly LayoutBox[] } {
  return "children" in box && Array.isArray((box as { children?: unknown }).children);
}

/**
 * Per-display-cluster advances for a text leaf, in display order.
 *
 * `clusterWidths` (when present) is a per-UTF-16-code-unit partition where the
 * interior code units of a multi-unit grapheme carry 0 (the full advance is on
 * the grapheme's FIRST code unit). The encoded run, by contrast, is one entry
 * per `for…of` code-point cluster, so we fold the per-code-unit widths back into
 * per-cluster sums by walking `box.text`'s code points and consuming the
 * matching number of code units from `clusterWidths`. When the folded count
 * does not match the encoded cluster count (e.g. clusterWidths absent or a
 * mismatch), even-split `box.width` and warn.
 */
function clusterAdvances(box: TextLeafBox, clusters: number): number[] {
  const cw = box.type === "text-run" ? box.clusterWidths : undefined;
  if (cw !== undefined && cw.length > 0) {
    const advances: number[] = [];
    let u = 0;
    for (const ch of box.text) {
      const units = ch.length;
      let sum = 0;
      for (let k = 0; k < units && u < cw.length; k++, u++) {
        const w = cw[u];
        // u < cw.length is checked in the loop guard, so cw[u] is present.
        if (w === undefined) throw new Error(`page-emitter: clusterWidth at ${u} unexpectedly undefined`);
        sum += w;
      }
      advances.push(sum);
    }
    if (advances.length === clusters) return advances;
  }
  if (box.type === "text-run") {
    // eslint-disable-next-line no-console
    console.warn(
      `[pdf] text-run clusterWidths absent or mismatched; even-splitting width ${box.width} across ${clusters} clusters`,
    );
  }
  const each = clusters > 0 ? box.width / clusters : 0;
  return Array.from({ length: clusters }, () => each);
}

function emitTextLeaf(
  box: TextLeafBox,
  absX: number,
  absY: number,
  pageHeightPx: number,
  builder: ContentStreamBuilder,
  deps: PageEmitDeps,
  usedHandleByKey: Map<string, PdfFontHandle>,
  linkRects: { url: string; rect: [number, number, number, number] }[],
  region: EmitRegion,
  ownerBlockId: string | null,
  mcidCounter: McidCounter,
  structRefs: StructRef[],
): void {
  if (box.text.length === 0) return;
  const cs = box.computedStyle;
  const fontSize: number = cs.fontSize;
  const handle = deps.provider.resolveFont(cs);
  const encoded = deps.provider.encodeRun(handle, box.text);
  // Register the handle as USED only when it actually emits glyphs. Adding it
  // before the empty-cluster guard would let `usedHandleByKey` (which drives
  // emitPdf's written font objects) diverge from the set of fonts that appear in
  // a content stream — leaving an allocated-but-unreferenced font object. Keeping
  // the add after the guard makes those two sets provably equal.
  if (encoded.clusters.length === 0) return;
  const key = handle.fontKey;
  if (!usedHandleByKey.has(key)) usedHandleByKey.set(key, handle);

  const halfLeading = (box.height - fontSize) / 2;
  const baselineEngineY = absY + halfLeading + fontSize;
  const advances = clusterAdvances(box, encoded.clusters.length);
  const rtl = box.bidiLevel !== undefined && box.bidiLevel % 2 === 1;

  // Parse the text color ONCE; reused for both the glyph fill and (below) the
  // decoration fill — same input, same parse.
  const fill = parseCssColor(cs.color ?? "#000000");
  if (fill !== null) builder.setFillColor(fill);

  const lefts: number[] = [];
  let prefix = 0;
  for (const a of advances) {
    lefts.push(prefix);
    prefix += a;
  }

  // #526 tagged PDF — wrap the visible run (glyphs + decorations) in a
  // marked-content sequence so AT can map painted content to structure.
  // A list/footnote MARKER routes to its OWNER block's structure element (its
  // `Lbl`); other text routes to the carried `ownerBlockId`. Header/footer
  // content is an ARTIFACT (excluded from the tree, no MCID). When
  // `structureBlockIds` is absent, NONE of the begin/end calls fire and the
  // stream is byte-identical to the untagged baseline.
  const ids = deps.structureBlockIds;
  // `owner` is only consulted on the tagging-active path (it can route to a
  // tagged Span), so compute it only there — when untagged it is never read.
  const owner = ids !== undefined && box.type === "marker" ? markerOwnerKey(box.key) : ownerBlockId;
  const tagged = ids === undefined
    ? "none" as const
    : region === "header" || region === "footer"
      ? "artifact" as const
      : owner !== null && ids.has(owner)
        ? "span" as const
        : "none" as const;
  let mcid = -1;
  if (tagged === "artifact") {
    builder.beginArtifact();
  } else if (tagged === "span") {
    mcid = mcidCounter.next++;
    builder.beginMarkedContent("Span", mcid);
  }

  const resourceName = deps.fontResourceName(key);
  for (let i = 0; i < encoded.clusters.length; i++) {
    const cluster = encoded.clusters[i];
    const left = lefts[i];
    const advance = advances[i];
    // i < encoded.clusters.length, and lefts/advances were built one-per-cluster
    // above, so all three indexed reads are in-bounds (structural invariant).
    if (cluster === undefined || left === undefined || advance === undefined) {
      throw new Error(`page-emitter: cluster geometry at ${i} unexpectedly undefined`);
    }
    const leftEngineX = rtl
      ? absX + box.width - (left + advance)
      : absX + left;
    const [px, py] = pointYUp(leftEngineX, baselineEngineY, pageHeightPx);
    builder.showTextAt(resourceName, fontSize, px, py, cluster.bytes);
  }

  // Text decorations — text-run boxes only (markers carry no decorations).
  // Thin 1px filled rects painted AFTER glyphs so they render on top.
  // Mirrors canvas-renderer.ts:1475-1485 geometry exactly.
  if (box.type === "text-run") {
    if (box.link !== undefined && isOpenableLinkUrl(box.link)) {
      const [lx, ly, lw, lh] = rectYUp(absX, absY, box.width, box.height, pageHeightPx);
      linkRects.push({ url: box.link, rect: [lx, ly, lx + lw, ly + lh] });
    }
    const decoFill = fill ?? BLACK;
    if (cs.underline === true) {
      // engine rect top-left y = absY + halfLeading + fontSize + 1
      const [x, y, w, h] = rectYUp(absX, absY + halfLeading + fontSize + 1, box.width, 1, pageHeightPx);
      builder.fillRect(decoFill, x, y, w, h);
    }
    if (cs.lineThrough === true) {
      // engine rect top-left y = absY + halfLeading + fontSize * 0.5 (mid-ascent)
      const [x, y, w, h] = rectYUp(absX, absY + halfLeading + fontSize * 0.5, box.width, 1, pageHeightPx);
      builder.fillRect(decoFill, x, y, w, h);
    }
  }

  // Close the #526 marked-content sequence opened above (EMC after the last
  // glyph/decoration) and record the MCID↔block correlation for a tagged Span.
  if (tagged === "artifact") {
    builder.endArtifact();
  } else if (tagged === "span") {
    builder.endMarkedContent();
    // `owner` is non-null here (the `tagged === "span"` branch requires it).
    if (owner === null) throw new Error("page-emitter: tagged span with null owner (unreachable)");
    structRefs.push({ blockId: owner, mcid, isMarker: box.type === "marker" });
  }
}

/**
 * Emit a box's BACKGROUND-phase graphics (currently: background fill). Called
 * for every NON-text-leaf box before recursing into its children, mirroring the
 * canvas renderer's background-phase paint order (background fills under content).
 */
function emitBoxBackgroundGraphics(
  box: LayoutBox,
  absX: number,
  absY: number,
  pageHeightPx: number,
  builder: ContentStreamBuilder,
): void {
  const bg = box.computedStyle.backgroundColor;
  if (bg !== "transparent") {
    const fill = parseCssColor(bg);
    if (fill !== null) {
      const [x, y, w, h] = rectYUp(absX, absY, box.width, box.height, pageHeightPx);
      builder.fillRect(fill, x, y, w, h);
    }
  }
}

/**
 * Emit a horizontal-rule fill for a box flagged `metadata.horizontalLine`
 * (e.g. an `<hr>`). A thin #dadce0 rect, 8px inset each side, vertically
 * centered — mirroring canvas-renderer.ts's HR paint.
 *
 * `metadata` lives only on `BlockBox` in the `LayoutBox` discriminated union,
 * so we narrow to `box.type === "block"` before accessing it.
 */
function emitHorizontalRule(
  box: LayoutBox,
  absX: number,
  absY: number,
  pageHeightPx: number,
  builder: ContentStreamBuilder,
): void {
  if (box.type !== "block" || box.metadata?.horizontalLine !== true) return;
  const fill = parseCssColor("#dadce0") ?? BLACK;
  const [x, y, w, h] = rectYUp(absX + 8, absY + box.height / 2 - 0.5, box.width - 16, 1, pageHeightPx);
  builder.fillRect(fill, x, y, w, h);
}

/**
 * Emit per-side border rects for a non-text-leaf box in the BACKGROUND phase.
 * Mirrors `canvas-renderer.ts:paintBorders`: each side is a solid filled rect
 * (dashed/dotted rendering is not implemented in the canvas renderer either —
 * v1 treats all styles as solid). Each side is only emitted when its width > 0
 * and its style is not "none".
 *
 * v1 simplification: inline-box fragments on soft-wrap line boundaries may
 * suppress the left or right border in the canvas renderer
 * (`paintInlineBorders`). Here we emit all four sides for every box, including
 * inline boxes — inline-fragment border-edge suppression is a v1 omission.
 */
function emitBoxBorders(
  box: LayoutBox,
  absX: number,
  absY: number,
  pageHeightPx: number,
  builder: ContentStreamBuilder,
): void {
  const sides = physicalBorderSides(box.usedStyle);
  const W = box.width;
  const H = box.height;

  const emit = (color: string, ex: number, ey: number, ew: number, eh: number): void => {
    const fill = parseCssColor(color) ?? BLACK;
    const [x, y, w, h] = rectYUp(ex, ey, ew, eh, pageHeightPx);
    builder.fillRect(fill, x, y, w, h);
  };

  if (sides.topWidth > 0 && sides.topStyle !== "none") {
    emit(sides.topColor, absX, absY, W, sides.topWidth);
  }
  if (sides.bottomWidth > 0 && sides.bottomStyle !== "none") {
    emit(sides.bottomColor, absX, absY + H - sides.bottomWidth, W, sides.bottomWidth);
  }
  if (sides.leftWidth > 0 && sides.leftStyle !== "none") {
    emit(sides.leftColor, absX, absY, sides.leftWidth, H);
  }
  if (sides.rightWidth > 0 && sides.rightStyle !== "none") {
    emit(sides.rightColor, absX + W - sides.rightWidth, absY, sides.rightWidth, H);
  }
}

/**
 * Emit a tab-leader (dot / dash / line) for a `"tab"` inline-block whose
 * destination stop carries a leader. The pattern fills the box's inline advance
 * along the text baseline in the computed text color — mirroring the canvas
 * renderer's `paintTabLeader` geometry exactly:
 *
 *  - The baseline sits at `absY + halfLeading + fontSize` (engine space), where
 *    `halfLeading = (height - fontSize) / 2` centers the em-box in the line —
 *    identical to the underline geometry in `emitTextLeaf`.
 *  - `line`: a single rule of thickness `max(0.5, fontSize*0.06)` spanning the
 *    full advance, top-left at `baselineEngineY - thickness`.
 *  - `dash`: short segments of length `max(2, fontSize*0.25)` separated by a
 *    `1.5×`-length gap, starting one gap in (so the leader does not crowd the
 *    preceding glyph), each clamped to fit fully inside the advance.
 *  - `dot`: filled circles of radius `max(0.5, fontSize*0.05)` spaced
 *    `max(3, fontSize*0.35)` apart, resting on the baseline (`dotY = baseline -
 *    radius`), starting/stopping one gap from each edge.
 *
 * The caller guarantees `box.inlineMeta.leader` is neither undefined nor "none".
 */
function emitTabLeader(
  box: Extract<LayoutBox, { type: "inline-block" }>,
  absX: number,
  absY: number,
  pageHeightPx: number,
  builder: ContentStreamBuilder,
): void {
  const W = box.width;
  if (W <= 0) return;
  const leader = box.inlineMeta?.leader;
  if (leader === undefined || leader === "none") return;
  const cs = box.computedStyle;
  const fontSize = cs.fontSize;
  const color = parseCssColor(cs.color ?? "#000000") ?? BLACK;
  const halfLeading = (box.height - fontSize) / 2;
  const baselineEngineY = absY + halfLeading + fontSize;

  const fillEngineRect = (ex: number, ey: number, ew: number, eh: number): void => {
    const [x, y, w, h] = rectYUp(ex, ey, ew, eh, pageHeightPx);
    builder.fillRect(color, x, y, w, h);
  };

  switch (leader) {
    case "line": {
      const t = Math.max(0.5, fontSize * 0.06);
      fillEngineRect(absX, baselineEngineY - t, W, t);
      return;
    }
    case "dash": {
      const t = Math.max(0.5, fontSize * 0.06);
      const dashLen = Math.max(2, fontSize * 0.25);
      const gap = dashLen * 1.5;
      const stride = dashLen + gap;
      const dashY = baselineEngineY - t;
      for (let dx = gap; dx + dashLen <= W; dx += stride) {
        fillEngineRect(absX + dx, dashY, dashLen, t);
      }
      return;
    }
    case "dot": {
      const r = Math.max(0.5, fontSize * 0.05);
      const gap = Math.max(3, fontSize * 0.35);
      const dotEngineY = baselineEngineY - r;
      for (let dx = gap; dx <= W - gap; dx += gap) {
        const [px, py] = pointYUp(absX + dx, dotEngineY, pageHeightPx);
        builder.fillCircle(color, px, py, r * PX_TO_PT);
      }
      return;
    }
    default: {
      // Exhaustiveness guard: a new LeaderStyle variant must add a case above.
      const _exhaustive: never = leader;
      return _exhaustive;
    }
  }
}

/**
 * Emit an image box's content in the BACKGROUND phase (under text), mirroring
 * the canvas renderer's image branch (canvas-renderer.ts): when the provider
 * resolves the `src`, place the Image XObject via `q cm Do Q`; otherwise draw a
 * grey `#f0f0f0` placeholder rect. The placement rect uses the box's image
 * intrinsic dims (`img.width`/`img.height`), exactly like the canvas renderer.
 *
 * The caller guarantees `box.type === "block"` and `box.metadata.image` present.
 */
function emitImage(
  box: Extract<LayoutBox, { type: "block" }>,
  absX: number,
  absY: number,
  pageHeightPx: number,
  builder: ContentStreamBuilder,
  deps: PageEmitDeps,
  usedImageByKey: Map<string, PdfImageHandle>,
  region: EmitRegion,
  ownerBlockId: string | null,
  mcidCounter: McidCounter,
  structRefs: StructRef[],
): void {
  const img = box.metadata?.image;
  if (img === undefined) return;
  const handle = deps.imageProvider?.resolveImage(img.src) ?? null;
  const [xPt, yBottomPt, wPt, hPt] = rectYUp(absX, absY, img.width, img.height, pageHeightPx);

  // #526 tagged PDF — an image owned by a tagged structure leaf becomes a
  // /Figure-class Span (MCID + structRef); a header/footer image, OR any image
  // whose owner is NOT in `structureBlockIds` (e.g. a decorative/HR image the
  // controller dropped from the set), becomes an /Artifact so nothing paints
  // bare. When `structureBlockIds` is absent, NEITHER branch fires and the draw
  // is byte-identical to the untagged baseline.
  const taggable = deps.structureBlockIds !== undefined;
  const asSpan = taggable
    && region !== "header" && region !== "footer"
    && ownerBlockId !== null
    && deps.structureBlockIds?.has(ownerBlockId) === true;
  let mcid = -1;
  if (asSpan) {
    mcid = mcidCounter.next++;
    builder.beginMarkedContent("Span", mcid);
  } else if (taggable) {
    builder.beginArtifact();
  }

  if (handle !== null) {
    if (!usedImageByKey.has(handle.imageKey)) usedImageByKey.set(handle.imageKey, handle);
    builder.drawImageXObject(deps.imageResourceName(handle.imageKey), [wPt, 0, 0, hPt, xPt, yBottomPt]);
  } else {
    // Grey placeholder — mirrors the canvas renderer's not-cached branch (#f0f0f0).
    builder.fillRect(parseCssColor("#f0f0f0") ?? BLACK, xPt, yBottomPt, wPt, hPt);
  }

  if (asSpan) {
    builder.endMarkedContent();
    // `ownerBlockId` is non-null in the `asSpan` branch.
    if (ownerBlockId === null) throw new Error("page-emitter: tagged image with null owner (unreachable)");
    structRefs.push({ blockId: ownerBlockId, mcid, isMarker: false });
  } else if (taggable) {
    builder.endArtifact();
  }
}

function walk(
  box: LayoutBox,
  parentAbsX: number,
  parentAbsY: number,
  pageHeightPx: number,
  phase: EmitPhase,
  builder: ContentStreamBuilder,
  deps: PageEmitDeps,
  usedHandleByKey: Map<string, PdfFontHandle>,
  usedImageByKey: Map<string, PdfImageHandle>,
  linkRects: { url: string; rect: [number, number, number, number] }[],
  internalLinkRects: { targetId: string; rect: [number, number, number, number] }[],
  insideTocEntry: boolean,
  region: EmitRegion,
  ownerBlockId: string | null,
  mcidCounter: McidCounter,
  structRefs: StructRef[],
): void {
  // Accumulate the box's absolute origin: parent-relative physical (x, y) plus
  // the optional `position: relative` paint-time delta — mirroring the canvas
  // renderer's paintBox accumulation (canvas-renderer.ts).
  const rel = box.relativeOffset;
  const absX = parentAbsX + box.x + (rel !== undefined ? rel.dx : 0);
  const absY = parentAbsY + box.y + (rel !== undefined ? rel.dy : 0);

  // #526 tagged PDF — carry the owning structure-leaf block id down the tree.
  // A LineBox stamps its `ownerBlockId` (the block whose IFC produced the line);
  // a BlockBox adopts its own source block id ONLY when that id is a tagged leaf
  // (so non-leaf container blocks don't shadow the line owner). The value flows
  // to `emitTextLeaf`/`emitImage`, which open the marked-content sequence.
  // Only consult `box.key` when tagging is active; the untagged path never reads
  // it, keeping that path identical to the pre-#526 behavior.
  let childOwnerBlockId = ownerBlockId;
  if (deps.structureBlockIds !== undefined) {
    if (box.type === "line") {
      childOwnerBlockId = box.ownerBlockId;
    } else if (box.type === "block") {
      const cand = sourceBlockIdOf(box.key);
      if (deps.structureBlockIds.has(cand)) childOwnerBlockId = cand;
    }
  }

  // Internal /GoTo links are collected FOREGROUND-only (walk runs twice). Two
  // sources: a TOC entry container (`metadata.navTarget`, whole-line click) and a
  // cross-ref atom (`InlineBlockBox.targetId`). A cross-ref atom INSIDE a TOC
  // entry is redundant with the container's whole-line link → suppressed.
  let childInsideTocEntry = insideTocEntry;
  if (phase === "foreground") {
    if (box.type === "block" && box.metadata?.navTarget !== undefined) {
      const [lx, ly, lw, lh] = rectYUp(absX, absY, box.width, box.height, pageHeightPx);
      internalLinkRects.push({ targetId: box.metadata.navTarget, rect: [lx, ly, lx + lw, ly + lh] });
      childInsideTocEntry = true;
    } else if (box.type === "inline-block" && box.targetId !== undefined && !insideTocEntry) {
      const [lx, ly, lw, lh] = rectYUp(absX, absY, box.width, box.height, pageHeightPx);
      internalLinkRects.push({ targetId: box.targetId, rect: [lx, ly, lx + lw, ly + lh] });
    }
  }

  if (isTextLeaf(box)) {
    // Text leaves carry no in-flow children and no abs-pos descendants. Glyphs
    // are foreground-only; the background pass is a no-op for a text leaf.
    if (phase === "foreground") {
      emitTextLeaf(box, absX, absY, pageHeightPx, builder, deps, usedHandleByKey, linkRects, region, ownerBlockId, mcidCounter, structRefs);
    }
    return;
  }
  if (phase === "background") {
    emitBoxBackgroundGraphics(box, absX, absY, pageHeightPx, builder);
    emitBoxBorders(box, absX, absY, pageHeightPx, builder);
    if (box.type === "block" && box.metadata?.image !== undefined) {
      emitImage(box, absX, absY, pageHeightPx, builder, deps, usedImageByKey, region, childOwnerBlockId, mcidCounter, structRefs);
    }
    emitHorizontalRule(box, absX, absY, pageHeightPx, builder);
  }
  // Tab leaders paint in the FOREGROUND — a `"tab"` inline-block whose
  // destination stop carries a non-"none" leader fills its inline advance with
  // a baseline-relative rule (mirrors canvas-renderer.ts's foreground-phase
  // inline-block branch, painted before recursing children).
  if (
    phase === "foreground" &&
    box.type === "inline-block" &&
    box.inlineMeta?.embedType === "tab" &&
    box.inlineMeta.leader !== undefined &&
    box.inlineMeta.leader !== "none"
  ) {
    emitTabLeader(box, absX, absY, pageHeightPx, builder);
  }
  if (box.type === "multicolumn") {
    for (const col of box.columns) walk(col, absX, absY, pageHeightPx, phase, builder, deps, usedHandleByKey, usedImageByKey, linkRects, internalLinkRects, childInsideTocEntry, region, childOwnerBlockId, mcidCounter, structRefs);
  } else if (hasChildren(box)) {
    for (const child of box.children) walk(child, absX, absY, pageHeightPx, phase, builder, deps, usedHandleByKey, usedImageByKey, linkRects, internalLinkRects, childInsideTocEntry, region, childOwnerBlockId, mcidCounter, structRefs);
  }
  // `position: absolute` descendants are OUT of `children`; they live in
  // `absoluteChildren` and are positioned in THIS box's coordinate frame, so
  // they recurse with the same accumulated (absX, absY) parent origin — exactly
  // as the painter does. Document order: children/columns first, then abs.
  const absChildren = box.absoluteChildren;
  if (absChildren !== undefined) {
    for (const ac of absChildren) walk(ac, absX, absY, pageHeightPx, phase, builder, deps, usedHandleByKey, usedImageByKey, linkRects, internalLinkRects, childInsideTocEntry, region, childOwnerBlockId, mcidCounter, structRefs);
  }
}

/**
 * Walk one positioned `PageBox`, emitting every text-bearing leaf (`text-run`
 * and `marker`) as absolutely-placed, per-cluster PDF text, plus every image box
 * as an XObject placement (or grey placeholder). Recurses through
 * block/line/inline/table/marker containers and through a `MultiColumnBox`'s
 * `columns`, plus the page's header/footer/footnote slots.
 *
 * The tree is walked TWICE: a BACKGROUND pass first (box backgrounds, borders,
 * images, and horizontal rules), then a FOREGROUND pass that emits text/marker
 * glyphs, their underline/line-through decorations, and tab leaders.
 * Background-first guarantees graphics paint UNDER text, mirroring the canvas
 * renderer's two `paintBox` invocations. `usedImageByKey`/`usedImages` is
 * populated during the BACKGROUND pass (images are background-only); whereas
 * `usedHandleByKey`/`usedHandles` is populated during the FOREGROUND pass (text
 * leaves are its sole contributors). The caller reads both after the two passes
 * complete.
 */
export function emitPageContent(page: PageBox, deps: PageEmitDeps): PageEmitResult {
  const builder = new ContentStreamBuilder();
  const usedHandleByKey = new Map<string, PdfFontHandle>();
  const usedImageByKey = new Map<string, PdfImageHandle>();
  const linkRects: { url: string; rect: [number, number, number, number] }[] = [];
  const internalLinkRects: { targetId: string; rect: [number, number, number, number] }[] = [];
  // #526 — one MCID allocator per page (starts at 0); one structRefs accumulator.
  const mcidCounter: McidCounter = { next: 0 };
  const structRefs: StructRef[] = [];
  const pageHeightPx = page.height;

  // Body children carry `region: "body"` (taggable → MCID); each PRESENT named
  // slot is walked separately with its own region — header/footer become
  // /Artifact (excluded from the structure tree), footnote bodies are body-class
  // taggable content. Without per-region walks, header/footer text would
  // mis-tag as body. Page children + slots are page-origin-relative (parent
  // origin (0, 0)), matching the canvas renderer after it zeroes the page frame.
  // The emission ORDER is body-children → header → footer → footnote (same as
  // before), preserving the untagged byte-golden output.
  const rootGroups: readonly { readonly roots: readonly LayoutBox[]; readonly region: EmitRegion }[] = [
    { roots: page.children, region: "body" },
    ...(page.headerSlot !== null ? [{ roots: [page.headerSlot], region: "header" as const }] : []),
    ...(page.footerSlot !== null ? [{ roots: [page.footerSlot], region: "footer" as const }] : []),
    ...(page.footnoteSlot !== null ? [{ roots: [page.footnoteSlot], region: "footnote" as const }] : []),
  ];

  for (const phase of ["background", "foreground"] as const) {
    for (const group of rootGroups) {
      for (const r of group.roots) {
        walk(
          r, 0, 0, pageHeightPx, phase, builder, deps,
          usedHandleByKey, usedImageByKey, linkRects, internalLinkRects, false,
          group.region, null, mcidCounter, structRefs,
        );
      }
    }
  }
  return {
    contentBytes: builder.toBytes(),
    usedHandles: [...usedHandleByKey.values()],
    usedImages: [...usedImageByKey.values()],
    linkRects,
    internalLinkRects,
    structRefs,
  };
}
