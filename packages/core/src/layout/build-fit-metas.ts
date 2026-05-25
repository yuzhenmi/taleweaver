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
import { groupChildren, anonymousBlockKey } from "./group-children";
import type { ChildGroup } from "./group-children";
import { layoutBlock } from "./bfc";
import { layoutInlineContent } from "./ifc";
import { makeRootContext, makeChildContext } from "./layout-context";
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
  const rootCs = cascadedRoot.computedStyle;
  if (rootCs === undefined) {
    throw new Error("buildBlockFitMetas: root must be cascaded (computedStyle missing)");
  }
  // `pageContentInlineSize` is the inline-size AVAILABLE to the root box (the
  // page content area). `buildMetasForChildren` threads "the content inline-size
  // for THIS parent's children" — so reduce the root's own inline padding here
  // ONCE (mirroring `bfc.layoutBlock`, which subtracts the root's inline padding
  // exactly once before laying out its children, bfc.ts:227). Every descendant
  // level then subtracts its own inline padding exactly once via `classifyChild`'s
  // recursion, and `ifcLeafMetaFromInlineRun` consumes the already-reduced width
  // DIRECTLY without re-subtracting.
  const rootContentInlineSize = contentInlineSizeOf(rootCs, pageContentInlineSize);
  return buildMetasForChildren(cascadedRoot, shaper, rootContentInlineSize);
}

/**
 * Build metas for the children of `parent`, mirroring `bfc.layoutBlock`'s
 * `groupChildren`-driven walk EXACTLY. `groupChildren` yields an ordered
 * sequence of `inline-run` groups and `block` groups; bfc lays each inline-run
 * group out as an anonymous IFC block (synthesizing `anonElement` and calling
 * `layoutInlineContent`) and each block group as a real block child. We mirror
 * that order:
 *   - `inline-run` group → an `ifc`-leaf meta whose lines come from laying the
 *     anonymous inline-run out via `layoutInlineContent` (margins 0, breaks auto
 *     — anonymous boxes have none).
 *   - `block` group → recurse via `classifyChild`.
 *
 * This is the single walk used at every nesting level AND at the document root,
 * so a MIXED-content container (block + bare inline runs) produces metas in the
 * same order `fitOnePage` consumes them, matching bfc's per-group placement.
 * `parentCs` is `parent.computedStyle` — the style the anonymous IFC block
 * inherits (bfc sets `computedStyle: cs` on `anonElement`), so its
 * orphans/widows come from `parentCs`, not the CSS default.
 */
function buildMetasForChildren(
  parent: ElementBox,
  shaper: TextShaper,
  parentContentInlineSize: number,
): readonly BlockFitMeta[] {
  const parentCs = parent.computedStyle;
  if (parentCs === undefined) {
    throw new Error("buildBlockFitMetas: parent must be cascaded (computedStyle missing)");
  }
  // `parentContentInlineSize` is the inline-size AVAILABLE to each of `parent`'s
  // children — i.e. the parent's CONTENT inline-size, with the parent's own
  // inline padding already subtracted exactly ONCE by the caller (the top-level
  // `buildBlockFitMetas` for the root, or `classifyChild` for a nested
  // container). bfc lays both block children (`makeChildContext(.., contentInlineSize)`,
  // bfc.ts:531) and the anonymous IFC for a bare inline run (bfc.ts:334) at this
  // same content width.
  const metas: BlockFitMeta[] = [];
  for (const group of groupChildren(parent)) {
    if (group.kind === "inline-run") {
      metas.push(ifcLeafMetaFromInlineRun(parent, parentCs, group, shaper, parentContentInlineSize));
    } else {
      const child = group.child;
      if (child.type !== "element") continue;
      metas.push(classifyChild(child, shaper, parentContentInlineSize));
    }
  }
  return metas;
}

/**
 * Build an `ifc`-leaf `BlockFitMeta` for an inline-run group — the anonymous IFC
 * block bfc synthesizes for a run of consecutive inline children. Mirrors
 * `bfc.ts:321–355`: synthesize the SAME anonymous `ElementBox` (key
 * `anonymousBlockKey(parent.key, positionalIndex)`, `computedStyle: parentCs`)
 * and lay it out UNFRAGMENTED via `layoutInlineContent` against the parent's
 * content inline-size — heights are position-independent. The resulting
 * LineBoxes give the per-line block-sizes / hyphen flags exactly as a leaf
 * paragraph's do.
 *
 * `parentContentInlineSize` is ALREADY the parent's content inline-size — the
 * parent's own inline padding was subtracted exactly once by the caller
 * (`buildMetasForChildren`). bfc lays this anonymous IFC at the parent's
 * `contentInlineSize` (bfc.ts:334) with the inline padding subtracted exactly
 * ONCE (bfc.ts:227), so we feed `parentContentInlineSize` to `makeChildContext`
 * DIRECTLY — re-applying `contentInlineSizeOf` here would subtract the inline
 * padding a SECOND time and shrink the wrap width, changing the line count.
 *
 * Anonymous boxes carry no margins and no break-* properties, so the leaf's
 * margins are 0 and its breaks are auto. orphans/widows come from `parentCs`
 * (the style the anonymous block inherits), matching the IFC line-fit
 * (`ifc.ts` reads `parentCs.orphans ?? 2`).
 */
function ifcLeafMetaFromInlineRun(
  parent: ElementBox,
  parentCs: ComputedStyle,
  group: Extract<ChildGroup, { kind: "inline-run" }>,
  shaper: TextShaper,
  parentContentInlineSize: number,
): BlockFitMeta {
  const anonKey = anonymousBlockKey(parent.key, group.positionalIndex);
  const anonElement: ElementBox = Object.freeze({
    type: "element" as const,
    key: anonKey,
    style: parent.style,
    computedStyle: parentCs,
    children: Object.freeze([...group.children]),
  });
  // The anonymous IFC inherits the parent's containing block; its content
  // inline-size IS `parentContentInlineSize` (already padding-reduced once). The
  // root context's containing-inline-size is irrelevant to the wrap (the child
  // context overrides it), but we pass the same value for consistency.
  const parentCtx = makeRootContext(parentCs, parentContentInlineSize);
  const ifcCtx = makeChildContext(parentCtx, parentCs, parentContentInlineSize, "indefinite");
  // Unfragmented IFC layout (no FragmentationContext): produces every line.
  const result = layoutInlineContent(anonElement, 0, 0, ifcCtx, shaper, undefined);
  if (result.box === null) {
    throw new Error("buildBlockFitMetas: unfragmented inline-run layout returned null box");
  }
  const lines = result.box.children.filter((c): c is LineBox => c.type === "line");
  const lineBlockSizes = lines.map((l) => l.blockSize);
  const lineEndsWithHyphen = lines.map((l) => l.endsWithHyphenContinuation === true);
  return {
    kind: "ifc",
    // Anonymous IFC blocks have no margins and no break properties.
    marginBlockStart: 0,
    marginBlockEnd: 0,
    breakBefore: "auto",
    breakAfter: "auto",
    breakInsideAvoid: false,
    listItem: false,
    // This leaf is a bare inline-run group, NOT a paragraph block: its break
    // token is the container's direct `{ifc, L}` resumeChildToken (no paragraph
    // wrap). See `BlockFitMeta.anonymousInlineRun`.
    anonymousInlineRun: true,
    totalBlockSize: result.box.blockSize,
    lineBlockSizes,
    orphans: parentCs.orphans ?? 2,
    widows: parentCs.widows ?? 2,
    lineEndsWithHyphen,
  };
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
  // Block-axis padding insets the children's fragmentation space by
  // `paddingBlockStart` (bfc.ts:229/350/540). `paddingBlockEnd` is added to the
  // container height after children are placed (bfc.ts:728) — already folded
  // into `totalBlockSize`; it ALSO inflates a fragmenting container's PARTIAL
  // height (bfc.ts:299), which `fitOnePage`'s §C.6 check needs. `noBottomBoundary`
  // (bfc.ts:224) decides whether the trailing child margin is suppressed in that
  // partial height. Border-block-width never shifts block-axis geometry in this
  // engine; it participates ONLY here, as a margin-collapse-through boundary.
  const noBottomBoundary =
    used.paddingBlockEnd === 0 && childCs.borderBlockEndWidth === 0;
  return {
    kind: "block",
    ...common,
    totalBlockSize: placed.blockSize,
    children,
    paddingBlockStart: used.paddingBlockStart,
    paddingBlockEnd: used.paddingBlockEnd,
    noBottomBoundary,
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
