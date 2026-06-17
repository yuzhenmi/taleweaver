import type { RenderNode, ElementBox, TextBox } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import type {
  IntrinsicSizes,
  IntrinsicContribution,
  IntrinsicSizesCache,
} from "@taleweaver/core";
import { flattenContents } from "./group-children";
import { resolveUsedLength } from "./used-style";
import { transformRun } from "@taleweaver/core";
import { assignTableGrid } from "./table-grid";
import type { GridCellInput } from "./table-grid";
import { distributeColumnIntrinsics } from "./table-column-sizing";
import type { SpannedCellIntrinsic } from "./table-column-sizing";
import { asBlockId } from "@taleweaver/core";

const ZERO_CONTRIBUTION: IntrinsicContribution = {
  minContent: 0,
  maxContent: 0,
  firstCluster: 0,
  restMin: 0,
};

/**
 * Compute the intrinsic inline-axis sizes (min-content, max-content) of
 * a render node. Recursive; results cached per render-node key.
 *
 * Spec: CSS Sizing 3 §6; `text-indent` per CSS Text §8 + CSS Sizing §5.
 *
 * The cache stores the extended {@link IntrinsicContribution} per node so a warm
 * cache short-circuits the whole subtree (no per-query re-shape). This public
 * boundary derives the `{minContent, maxContent}` view that consumers read.
 */
export function computeIntrinsicSizes(
  node: RenderNode,
  shaper: TextShaper,
  cache: IntrinsicSizesCache,
): IntrinsicSizes {
  const { minContent, maxContent } = computeContribution(node, shaper, cache);
  return { minContent, maxContent };
}

/**
 * Recursion core. Returns the extended {@link IntrinsicContribution} so a
 * parent block/inline can apply `text-indent` to its first formatted line.
 * Reads/writes the persistent `cache` per node — a warm entry short-circuits
 * the subtree, preserving cross-call (and within-call) memoization.
 */
function computeContribution(
  node: RenderNode,
  shaper: TextShaper,
  cache: IntrinsicSizesCache,
): IntrinsicContribution {
  const cached = cache.get(node.key);
  if (cached) return cached;

  const contribution = computeContributionUncached(node, shaper, cache);
  cache.set(node.key, contribution);
  return contribution;
}

function computeContributionUncached(
  node: RenderNode,
  shaper: TextShaper,
  cache: IntrinsicSizesCache,
): IntrinsicContribution {
  if (node.type === "text") {
    return computeTextContribution(node, shaper);
  }
  // ElementBox
  const cs = node.computedStyle;
  if (!cs) {
    // Should not happen post-cascade, but be defensive.
    return ZERO_CONTRIBUTION;
  }
  // Tab stops S3: a `"tab"` embed (recognized by its marker metadata) is an
  // atomic inline-block whose advance is position-dependent at layout time and
  // has no stop context during an intrinsic query. Reserve `defaultTabStop` (D)
  // as a conservative advance so a shrink-to-fit / inline-block container sizes
  // to include the tab (matching browsers' `tab-size` intrinsic treatment).
  // Without this the tab's rendered `inlineSize: 0` would undercount the line.
  if (node.metadata?.embedType === "tab") {
    const d = cs.defaultTabStop;
    return { minContent: d, maxContent: d, firstCluster: d, restMin: d };
  }
  switch (cs.display) {
    case "block":
    case "list-item":
    case "inline-block":
    case "table-cell":
      return computeBlockContribution(node, shaper, cache);
    case "inline":
      return computeInlineContribution(node, shaper, cache);
    case "table":
      return liftToContribution(computeTableIntrinsicSizes(node, shaper, cache));
    case "contents":
      // No box of its own; its children contribute as if direct children of
      // its parent. Treated as a block container here (the general mixed
      // block+inline case). Reached only if a `contents` element is the ROOT of
      // an intrinsic query — the common child case is handled by the
      // `flattenContents` calls in the block/inline loops below.
      return computeBlockContribution(node, shaper, cache);
    case "table-row":
    case "none":
    default:
      return ZERO_CONTRIBUTION;
  }
}

/**
 * Lift a public `{min, max}` (e.g. from the table path, which has no inline
 * first-cluster notion) into a contribution. A table is a real block-level box,
 * so it has no "first formatted line" of inline content to indent: its
 * `firstCluster` is 0 and `restMin` is its whole min-content. That makes an
 * enclosing block's first-run indent fold leave a table child's contribution
 * unchanged — correct, since browsers don't indent before a block-level child.
 */
function liftToContribution(sizes: IntrinsicSizes): IntrinsicContribution {
  return {
    minContent: sizes.minContent,
    maxContent: sizes.maxContent,
    firstCluster: 0,
    restMin: sizes.minContent,
  };
}

function computeTextContribution(
  node: TextBox,
  shaper: TextShaper,
): IntrinsicContribution {
  if (!node.computedStyle) return ZERO_CONTRIBUTION;
  const rawText = node.text;
  if (rawText.length === 0) return ZERO_CONTRIBUTION;
  // Shape the DISPLAY text under `text-transform`: a case mapping can change the
  // glyph count/width (e.g. `ß`→`SS` under `uppercase`), and the IFC shapes the
  // same transformed string. Intrinsic min/max-content must match so a
  // shrink-to-fit / inline-block box sizes to the rendered width (else it clips).
  // Transforming the whole node text is correct here — we only need the total
  // display width, and `capitalize`'s word boundaries resolve identically across
  // the whole string as per-token. `none` (the default) is a no-op, keeping
  // existing layout byte-identical.
  const tt = node.computedStyle.textTransform;
  const text = tt !== "none" ? transformRun(rawText, tt).display : rawText;
  const run = shaper.shape(text, node.computedStyle, node.computedStyle.direction);
  // Clusters are in LOGICAL order (text-shaper.ts), so clusters[0] is the
  // run's first grapheme cluster.
  const clusters = run.clusters;
  // CSS min-content of a text run is the WIDEST UNBREAKABLE SEGMENT — the widest
  // run of clusters between two UAX #14 break opportunities — NOT the widest
  // single grapheme cluster. A `minClusterInlineSize`-only floor under-sizes any
  // unbreakable multi-character word (e.g. a 10-char word floored at one glyph),
  // so a shrink-to-fit / inline-block / `min-content` box clamps narrower than
  // its content and clips it. `breakOpportunities[i].clusterIndex` is a UTF-16
  // code-unit offset at which a line MAY break (break is BEFORE the offset),
  // aligned with `Cluster.start`/`end` — so we close the running segment whenever
  // a cluster's start coincides with a break offset and take the widest segment.
  // Computing from the SAME break offsets the IFC wraps at makes min-content equal
  // the narrowest line the IFC can produce. `minClusterInlineSize` (widest single
  // cluster, always ≤ a segment) is kept as a `max` lower bound so a coarser
  // word-aware shaper still floors correctly.
  // HYPH.S2 — under `hyphens: none`, drop the in-word break a soft hyphen
  // (U+00AD, UAX #14 class BA) suggests, mirroring the IFC's `annotateLineBreaks`
  // suppression. This is a DISTINCT correction from the slice-1 zero-advance fix:
  // zeroing the soft hyphen's width does NOT remove its break opportunity, so
  // without this filter min-content would still split the word there. A break at
  // `clusterIndex` is BEFORE that offset, so the soft hyphen sits at `idx - 1`.
  const noHyphenBreaks = node.computedStyle.hyphens === "none";
  const breakOffsets = new Set(
    run.breakOpportunities
      .filter((b) => !(noHyphenBreaks && text.charCodeAt(b.clusterIndex - 1) === 0x00ad))
      .map((b) => b.clusterIndex),
  );
  let widestSegment = 0;
  let segWidth = 0;
  for (const cl of clusters) {
    if (segWidth > 0 && breakOffsets.has(cl.start)) {
      if (segWidth > widestSegment) widestSegment = segWidth;
      segWidth = 0;
    }
    segWidth += cl.inlineAdvance;
  }
  if (segWidth > widestSegment) widestSegment = segWidth;
  // `overflow-wrap: anywhere` (CSS Text 3 §5.1) makes the last-resort within-word
  // break point COUNT for min-content: a shrink-to-fit / inline-block box can narrow
  // to ONE grapheme. So min-content collapses to the widest single cluster, NOT the
  // widest unbreakable segment. `break-word` does NOT change min-content (used-layout
  // break only) — only `anywhere` does. (max-content is the longest unbreakable RUN,
  // a used-layout concept, unaffected by either.)
  const minContent =
    node.computedStyle.overflowWrap === "anywhere"
      ? run.minClusterInlineSize
      : Math.max(run.minClusterInlineSize, widestSegment);
  const firstCluster = clusters[0]?.inlineAdvance ?? 0;
  // `restMin` = the run's min-content EXCLUDING the first (indented) unit. The
  // indent pushes only the first formatted line, which holds the run's first
  // unbreakable unit; the rest is bounded by `restMin`.
  //
  // We must keep the invariant `max(firstCluster, restMin) === minContent` so a
  // parent's NON-indented run fold (`max(runFirstCluster, runRestMin)`) equals
  // the authoritative min — byte-identical at indent 0. Two cases:
  //
  //  - `firstCluster < minContent`: the widest unbreakable unit is NOT the first
  //    cluster (e.g. a word-aware shaper whose `minClusterInlineSize` is the
  //    longest WORD, wider than any single character; or a later, wider cluster).
  //    Excluding the first cluster can't lower the min floor, so `restMin =
  //    minContent`. Invariant: `max(firstCluster, minContent) = minContent` ✓.
  //  - `firstCluster === minContent` (the first cluster IS the widest single
  //    unit — the break-at-any-cluster case): excluding it lets the rest narrow,
  //    so `restMin` = the widest cluster in the TAIL (0 when there is no tail).
  //    This is what makes a NEGATIVE indent able to narrow the box past the
  //    no-indent min. Invariant: `max(minContent, tailMax≤minContent) =
  //    minContent` ✓.
  let restMin: number;
  if (firstCluster < minContent) {
    restMin = minContent;
  } else {
    let tailMax = 0;
    // Iterate the tail (skip the first cluster) by value — `clusters` is a dense
    // array, so the index read it replaces was always present.
    for (const cluster of clusters.slice(1)) {
      const w = cluster.inlineAdvance;
      if (w > tailMax) tailMax = w;
    }
    restMin = tailMax;
  }
  return {
    minContent,
    maxContent: run.unbreakableRunInlineSize,
    firstCluster,
    restMin,
  };
}

function computeBlockContribution(
  node: ElementBox,
  shaper: TextShaper,
  cache: IntrinsicSizesCache,
): IntrinsicContribution {
  const cs = node.computedStyle;
  // A block-level box with a DEFINITE (numeric) inline size contributes that
  // size as BOTH its min- and max-content — its own content does not feed the
  // intrinsic sizes once the inline axis is pinned (CSS Sizing 3 §5.1: a box
  // with a definite size resolves to that size). This is what lets a sized but
  // CHILDLESS block — e.g. an inline image's inner `display:block` image box,
  // which carries explicit `inlineSize`/`blockSize` and no children — report a
  // nonzero intrinsic width so the wrapping inline-block shrink-to-fits to the
  // image rather than collapsing to the empty-content fallback. The
  // `firstCluster`/`restMin` follow the same outer-display rule as the
  // content-derived path below (inline-block exposes its own size as the first
  // cluster; a real block exposes 0). A percentage inline size stays
  // indefinite during an intrinsic query, so only the numeric case short-circuits.
  if (cs && typeof cs.inlineSize === "number") {
    const definite = cs.inlineSize;
    const isInlineBlockBox = cs.display === "inline-block";
    return {
      minContent: definite,
      maxContent: definite,
      firstCluster: isInlineBlockBox ? definite : 0,
      restMin: definite,
    };
  }
  // Resolve the indent with a containing inline-size basis of 0: a percentage
  // text-indent resolves against an indefinite size during an intrinsic query,
  // which CSS Sizing §5.1 treats as 0 (matches percentage padding/margin in
  // intrinsic sizing). Length indents pass through. `cs.textIndent` is a
  // `ComputedLength` (never "auto"), so the third arg is inert.
  const indent = cs ? resolveUsedLength(cs.textIndent, 0, 0) : 0;

  // L-F / C3: per CSS Sizing 3 §5.2 (max-content of a block container),
  // a block container with mixed block + inline children performs
  // anonymous-block wrapping: each consecutive run of inline children
  // becomes one anonymous block. Container's max-content is then the
  // max over (real block children's max-content) AND (each
  // anonymous-block run's max-content). Within a run, max-content =
  // sum of inline children's max-content (one line, no wrap).
  let containerMin = 0;
  let containerMax = 0;

  // Per-run accumulators. text-indent applies to the block's FIRST formatted
  // line only (CSS Text §8). The first formatted line lives in the LEADING
  // inline run — i.e. an inline run that is also the block's first child group.
  // If any block-level child precedes the first inline run, that run is NOT the
  // first formatted line and is left un-indented (matches browsers; the
  // anonymous block boxes are separate and only the first one — in document
  // order — is indented).
  let runMax = 0;
  let runRestMin = 0; // max over (firstChild.restMin, laterChildren.minContent)
  let runFirstCluster = 0; // firstCluster of the run's first content-bearing child
  let runHasFirstChild = false;
  let runActive = false;
  let processedAnyChild = false; // has any child (block or inline) been handled?
  let currentRunIsLeading = false; // is the active run the block's first child group?

  const flushRun = (): void => {
    if (!runActive) return;
    let runMin = Math.max(runFirstCluster, runRestMin);
    let foldedMax = runMax;
    if (currentRunIsLeading && indent !== 0) {
      // Apply text-indent to the block's first formatted line only.
      runMin = Math.max(0, Math.max(indent + runFirstCluster, runRestMin));
      foldedMax = Math.max(0, runMax + indent);
    }
    if (runMin > containerMin) containerMin = runMin;
    if (foldedMax > containerMax) containerMax = foldedMax;
    runActive = false;
    runMax = 0;
    runRestMin = 0;
    runFirstCluster = 0;
    runHasFirstChild = false;
    currentRunIsLeading = false;
  };

  for (const child of flattenContents(node.children)) {
    const isInline =
      child.type === "text" ||
      (child.type === "element" &&
        (child.computedStyle?.display === "inline" ||
          child.computedStyle?.display === "inline-block"));
    const c = computeContribution(child, shaper, cache);
    if (isInline) {
      if (!runActive) {
        runActive = true;
        runMax = 0;
        runRestMin = 0;
        runFirstCluster = 0;
        runHasFirstChild = false;
        // A run is the block's first formatted line only if it leads the block
        // (no block-level child precedes it).
        currentRunIsLeading = !processedAnyChild;
      }
      runMax += c.maxContent; // sum within a run (no wrap at max-content)
      if (!runHasFirstChild) {
        // First child of the run owns the run's first cluster; its rest-min
        // seeds the run's rest-min.
        runFirstCluster = c.firstCluster;
        runRestMin = Math.max(runRestMin, c.restMin);
        runHasFirstChild = true;
      } else {
        // Later children of the run contribute their whole min-content to the
        // run's rest (they can't be the first cluster of the first line).
        runRestMin = Math.max(runRestMin, c.minContent);
      }
    } else {
      flushRun();
      if (c.minContent > containerMin) containerMin = c.minContent;
      if (c.maxContent > containerMax) containerMax = c.maxContent;
    }
    processedAnyChild = true;
  }
  flushRun();

  // What this node exposes as its OWN first cluster to an enclosing indented
  // run depends on its outer display:
  //  - A real block / list-item / table-cell is a block-level box. It is never
  //    the first child of an enclosing inline run, and an enclosing block never
  //    indents before a block-level child, so it exposes no inline first-cluster
  //    (`firstCluster: 0`).
  //  - An `inline-block` is an ATOMIC inline-level box (CSS2 §16.1: "the first
  //    box that flows into the block's first line box"). When it is the first
  //    box on an enclosing block's indented first line, the indent pushes the
  //    WHOLE inline-block, so its first-unit contribution is its own min-content
  //    (`containerMin`), not 0 — otherwise the enclosing min-content would be
  //    undercounted by the inline-block's width and it would overflow.
  // In both cases `restMin = containerMin`, so the box's own
  // `minContent === max(firstCluster, restMin)` holds (inline-block:
  // `max(containerMin, containerMin)`; block: `max(0, containerMin)`).
  const isInlineBlock = cs?.display === "inline-block";
  return {
    minContent: containerMin,
    maxContent: containerMax,
    firstCluster: isInlineBlock ? containerMin : 0,
    restMin: containerMin,
  };
}

function computeInlineContribution(
  node: ElementBox,
  shaper: TextShaper,
  cache: IntrinsicSizesCache,
): IntrinsicContribution {
  // Inline (sequence): min = max(child.min); max = sum(child.max).
  // For the indent plumbing: firstCluster = the first child's firstCluster;
  // restMin = max(firstChild.restMin, child₂.min, child₃.min, …).
  let sum = 0;
  let restMin = 0;
  let firstCluster = 0;
  let hasFirst = false;
  for (const child of flattenContents(node.children)) {
    const c = computeContribution(child, shaper, cache);
    sum += c.maxContent;
    if (!hasFirst) {
      firstCluster = c.firstCluster;
      restMin = Math.max(restMin, c.restMin);
      hasFirst = true;
    } else {
      restMin = Math.max(restMin, c.minContent);
    }
  }
  return {
    minContent: Math.max(firstCluster, restMin),
    maxContent: sum,
    firstCluster,
    restMin,
  };
}

function computeTableIntrinsicSizes(
  node: ElementBox,
  shaper: TextShaper,
  cache: IntrinsicSizesCache,
): IntrinsicSizes {
  // Walk rows → cells. For each cell, collect intrinsic sizes.
  // Per column, colMin = max(cell.min for cells in this column).
  //              colMax = max(cell.max for cells in this column).
  // Table min = sum(colMin); table max = sum(colMax).

  // Both walks go through `flattenContents` so a `display: contents` wrapper
  // (e.g. a `section` containing table rows in P1.C) is transparent here, just
  // as it is in BFC / IFC layout and in the inline intrinsic path above. Without
  // the flatten, the `display !== "table-row"` / "table-cell" filters would skip
  // the contents wrapper and silently produce { min: 0, max: 0 }.
  //
  // Cells are placed onto the same §17.5 grid the Table FC builds (assignTableGrid)
  // and their intrinsic sizes fed — keyed by grid placement — into the §17.4
  // span-aware distributor (P8.S2), so a colSpan>1 cell contributes across the
  // columns it spans rather than being charged entirely to one column.
  const gridRows: GridCellInput[][] = [];
  const measures: { min: number; max: number }[] = []; // document order, 1:1 with grid cells
  for (const row of flattenContents(node.children)) {
    if (row.type !== "element" || row.computedStyle?.display !== "table-row") continue;
    const rowInputs: GridCellInput[] = [];
    for (const cell of flattenContents(row.children)) {
      if (cell.type !== "element" || cell.computedStyle?.display !== "table-cell") continue;
      rowInputs.push({ key: asBlockId(cell.key), metadata: cell.metadata });
      const cellSizes = computeIntrinsicSizes(cell, shaper, cache);
      measures.push({ min: cellSizes.minContent, max: cellSizes.maxContent });
    }
    gridRows.push(rowInputs);
  }

  const grid = assignTableGrid(gridRows);
  const spanned: SpannedCellIntrinsic[] = grid.cells.map((ac, i) => ({
    gridCol: ac.gridCol,
    colSpan: ac.colSpan,
    min: measures[i]?.min ?? 0,
    max: measures[i]?.max ?? 0,
  }));
  const { colMins, colMaxes } = distributeColumnIntrinsics(spanned, grid.columnCount);

  const tableMin = colMins.reduce((s, v) => s + v, 0);
  const tableMax = colMaxes.reduce((s, v) => s + v, 0);
  return { minContent: tableMin, maxContent: tableMax };
}
