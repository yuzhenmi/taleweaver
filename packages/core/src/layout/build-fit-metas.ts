// packages/core/src/layout/build-fit-metas.ts
//
// Build the per-block `BlockFitMeta[]` that the measure pass / fit-core consume
// (virtualized-layout Phase 1). A meta carries the allocation-free inputs the
// fit-core needs to reproduce every page-break decision — margins, break
// properties, total height, and (for leaves) per-line / per-row block-sizes.
//
// The metas mirror the block tree: a container block (blockquote, list, nested
// BFC) carries recursive `children`; a leaf carries either IFC line data
// (a paragraph) or table row data.
//
// Design: docs/superpowers/specs/2026-05-24-virtualized-layout-design.md
// Plan:   docs/superpowers/plans/2026-05-24-virtualized-layout-phase1.md

import type { ElementBox } from "../render/render-node";
import type { LayoutBox, LineBox } from "./layout-box-v2";
import type { BlockFitMeta } from "./fit-core";
import type { TextShaper } from "./text-shaper";
import { groupChildren } from "./group-children";
import { layoutBlock } from "./bfc";
import { makeRootContext } from "./layout-context";
import { computeUsedStyle } from "./used-style";
import { normalizeBreakValue } from "./fragmentation";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { ComputedStyle } from "../styles";

/**
 * Build the top-level `BlockFitMeta[]` for a cascaded document root, recursing
 * into container blocks. `pageContentInlineSize` is the per-page content-area
 * inline-size (page inline-size minus inline margins) — the same width
 * `paginateRoot` lays each page out against, so the line/row block-sizes here
 * match the positioned tree's.
 *
 * Each top-level child of `cascadedRoot` becomes one meta. The classification
 * mirrors `bfc.layoutBlock`'s `groupChildren`-driven dispatch:
 *   - all-inline-run content   → `kind: "ifc"` leaf (line block-sizes)
 *   - `display: "table"`        → `kind: "table"` leaf (row block-sizes)
 *   - has block children        → `kind: "block"` container (recursive children)
 */
export function buildBlockFitMetas(
  cascadedRoot: ElementBox,
  shaper: TextShaper,
  pageContentInlineSize: number,
): readonly BlockFitMeta[] {
  return buildMetasForChildren(cascadedRoot, shaper, pageContentInlineSize);
}

/**
 * Build metas for the block-level children of `parent`. Inline-run groups at
 * this level are not standalone children — they would be wrapped by the parent
 * block's own IFC — so a `parent` that mixes block + inline children is itself
 * an IFC/mixed leaf and is handled by the caller's per-child classification
 * (`classifyChild`), not here. This walk only emits one meta per block child,
 * matching `fitOnePage`'s top-level walk (which consumes one meta per
 * top-level block).
 */
function buildMetasForChildren(
  parent: ElementBox,
  shaper: TextShaper,
  pageContentInlineSize: number,
): readonly BlockFitMeta[] {
  const metas: BlockFitMeta[] = [];
  for (const child of parent.children) {
    if (child.type !== "element") continue;
    metas.push(classifyChild(child, shaper, pageContentInlineSize));
  }
  return metas;
}

/**
 * Classify one block-level child into a `BlockFitMeta`. Reads margins / breaks
 * from the child's computed style; total height + line/row sizes from an
 * UNFRAGMENTED layout of the child (heights are position-independent).
 */
function classifyChild(
  child: ElementBox,
  shaper: TextShaper,
  pageContentInlineSize: number,
): BlockFitMeta {
  const childCs = child.computedStyle;
  if (childCs === undefined) {
    throw new Error("buildBlockFitMetas: child must be cascaded (computedStyle missing)");
  }

  const used = computeUsedStyle(childCs, pageContentInlineSize, "indefinite");
  const marginBlockStart = used.marginBlockStart;
  const marginBlockEnd = used.marginBlockEnd;
  const breakBefore = normalizeBreakValue(childCs.breakBefore ?? "auto");
  const breakAfter = normalizeBreakValue(childCs.breakAfter ?? "auto");
  const breakInsideAvoid = normalizeBreakValue(childCs.breakInside ?? "auto") === "avoid";
  const listItem = childCs.display === "list-item";

  const common = {
    marginBlockStart,
    marginBlockEnd,
    breakBefore,
    breakAfter,
    breakInsideAvoid,
    listItem,
  };

  // The placed box for this child — obtained by laying it out as a child of a
  // synthetic wrapper, so bfc applies the SAME placement logic the real
  // paginated layout uses: explicit block-size override (bfc.ts:615–617) and
  // the empty-block rule (bfc.ts:676–709). Laying the child out directly via
  // `layoutBlock(child, …)` would skip those parent-applied rules and report a
  // 0-height box for an explicit-block-size empty spacer.
  const placed = layoutChildInWrapper(child, shaper, pageContentInlineSize);

  // --- Table leaf. ---
  if (childCs.display === "table") {
    const rowBlockSizes =
      placed.type === "table"
        ? placed.children
            .filter((c): c is LayoutBox => c.type === "table-row")
            .map((row) => row.blockSize)
        : [];
    return {
      kind: "table",
      ...common,
      totalBlockSize: placed.blockSize,
      rowBlockSizes,
    };
  }

  // --- Container vs IFC leaf. ---
  // A child whose grouped content includes an inline-run AND no block children
  // is an IFC leaf (a paragraph). A child with block children is a container
  // that `fitOnePage` recurses into. A child with NO content (empty block, e.g.
  // a fixed-height spacer with explicit blockSize) is a degenerate container
  // with empty children — NOT an IFC leaf — so the fit-core treats it as a
  // whole-block-fit candidate, matching bfc (which lays it out as a block of
  // its explicit/auto height, never running the IFC line-fit).
  const groups = groupChildren(child);
  const hasBlockChild = groups.some((g) => g.kind === "block");
  const hasInlineRun = groups.some((g) => g.kind === "inline-run");

  if (!hasBlockChild && hasInlineRun) {
    // IFC leaf: the placed block's direct children are the LineBoxes.
    const lines =
      placed.type === "block"
        ? placed.children.filter((c): c is LineBox => c.type === "line")
        : [];
    const lineBlockSizes = lines.map((l) => l.blockSize);
    const lineEndsWithHyphen = lines.map((l) => l.endsWithHyphenContinuation === true);
    return {
      kind: "ifc",
      ...common,
      totalBlockSize: placed.blockSize,
      lineBlockSizes,
      orphans: childCs.orphans ?? 2,
      widows: childCs.widows ?? 2,
      lineEndsWithHyphen,
    };
  }

  // Container block: recurse into its block children.
  const children = buildMetasForChildren(child, shaper, contentInlineSizeOf(childCs, pageContentInlineSize));
  return {
    kind: "block",
    ...common,
    totalBlockSize: placed.blockSize,
    children,
  };
}

/**
 * Lay `child` out as the sole child of a synthetic anonymous wrapper block and
 * return the PLACED child box (the wrapper's first child). This reproduces the
 * exact parent-applied placement bfc uses for a real top-level child: explicit
 * block-size override and the empty-block-collapse rule. The wrapper has no
 * padding/border/margin so it does not perturb the child's own height.
 *
 * Heights are position-independent, so the resulting box's `blockSize` and its
 * descendant LineBox / TableRowBox `blockSize`s are the correct metadata
 * regardless of where the child eventually lands on a page.
 */
function layoutChildInWrapper(
  child: ElementBox,
  shaper: TextShaper,
  pageContentInlineSize: number,
): LayoutBox {
  const wrapper: ElementBox = {
    type: "element",
    key: `${child.key}/fit-meta-wrapper`,
    style: Object.freeze({ display: "block" }),
    computedStyle: INITIAL_COMPUTED_STYLE,
    children: Object.freeze([child]),
  };
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageContentInlineSize);
  const result = layoutBlock(wrapper, 0, 0, ctx, shaper, undefined);
  if (result.box === null) {
    throw new Error("buildBlockFitMetas: unfragmented wrapper layout returned null box");
  }
  // Find the placed child by key. For a `display: list-item` child, bfc emits a
  // separate sibling `MarkerBox` (`${child.key}-marker`) BEFORE the block, so
  // `children[0]` is the marker, not the list-item block — match by key instead
  // of index. The marker contributes no block-axis advance (it shares the
  // list-item's line), so it does not affect the metadata.
  const placed = result.box.children.find((c) => c.key === child.key);
  if (placed === undefined) {
    throw new Error("buildBlockFitMetas: wrapper produced no placed child for " + child.key);
  }
  return placed;
}

/**
 * The content-area inline-size of a block given its computed style and the
 * inline-size available to it. Children of a container are laid out (and thus
 * wrap their lines) against the container's CONTENT width — outer inline-size
 * minus the container's own inline padding/border — so the recursive metas use
 * that reduced width, matching `bfc.layoutBlock`'s `contentInlineSize`.
 */
function contentInlineSizeOf(cs: ComputedStyle, availableInlineSize: number): number {
  const used = computeUsedStyle(cs, availableInlineSize, "indefinite");
  // bfc.ts:226–227: `contentInlineSize = finalInlineSize − paddingInlineStart −
  // paddingInlineEnd` (padding only; border is NOT subtracted there).
  // finalInlineSize resolves `inline-size: auto` to the available width.
  const finalInlineSize =
    typeof cs.inlineSize === "number" ? cs.inlineSize : availableInlineSize;
  return finalInlineSize - used.paddingInlineStart - used.paddingInlineEnd;
}
