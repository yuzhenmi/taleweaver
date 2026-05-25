// packages/core/src/layout/virtual-producer.ts
//
// Shared paginated-path producer (virtualized-layout Phase 3, Task 1).
//
// Both the incremental (`layoutTreeIncremental`) and the full-build
// (`dispatch.layoutTree`) paginated paths must produce a `VirtualLayoutTree`
// IDENTICALLY: same metas, same measure pass, same `makeVirtualLayoutTree`
// wiring. This helper is that single source so the two callers cannot drift.
//
// `buildVirtualPaginatedTree` derives `pageContentInlineSize` exactly as
// `paginateRoot` / `makeVirtualLayoutTree` do (page inline-size minus inline
// margins) and threads the caller's already-built root `LayoutContext` (the
// same `ctx`/`rootCtx` `paginateRoot` is given — `makeVirtualLayoutTree`
// narrows it to the content area internally). `prevTree` carries the prior
// `VirtualLayoutTree` for the carry-forward memo; pass it only when the prior
// layout was virtual.
//
// Design: docs/superpowers/specs/2026-05-24-virtualized-layout-design.md
// Plan:   docs/superpowers/plans/2026-05-24-virtualized-layout-phase3.md

import type { ElementBox } from "../render/render-node";
import type { LayoutContext } from "./layout-context";
import type { TextShaper } from "./text-shaper";
import type { PageConfig } from "./page-config";
import { buildBlockFitMetas } from "./build-fit-metas";
import { measurePass } from "./measure-pass";
import { flattenContents } from "./group-children";
import { makeVirtualLayoutTree, type VirtualLayoutTree } from "./virtual-layout-tree";

/**
 * Build a `VirtualLayoutTree` for a paginated `display: block` document root.
 *
 * Callers must already have gated on `!measurePassUnsupported(cascadedRoot)`
 * (float/`clear` documents fall back to the legacy positioned `paginateRoot`
 * path) and `cascadedRoot.computedStyle?.display === "block"`.
 *
 * @param cascadedRoot the cascaded document root (must have `computedStyle`).
 * @param ctx the root `LayoutContext` (writingMode/direction/etc.) — the SAME
 *   one `paginateRoot` would receive; `makeVirtualLayoutTree` narrows its
 *   containing inline-size to the page content area internally.
 * @param shaper the text shaper used for both metas and per-page positioning.
 * @param pageConfig pagination parameters.
 * @param prevTree the prior `VirtualLayoutTree` for the carry-forward memo, or
 *   `undefined` when there is none (first build / prior layout was positioned).
 */
export function buildVirtualPaginatedTree(
  cascadedRoot: ElementBox,
  ctx: LayoutContext,
  shaper: TextShaper,
  pageConfig: PageConfig,
  prevTree?: VirtualLayoutTree,
): VirtualLayoutTree {
  const margins = pageConfig.pageMargins;
  const pageContentInlineSize =
    pageConfig.pageInlineSize - margins.inlineStart - margins.inlineEnd;

  const metas = buildBlockFitMetas(cascadedRoot, shaper, pageContentInlineSize);
  // Thread the prior plan into the measure pass for the incremental
  // carry-forward (reuses unchanged page entries, skipping `fitOnePage`). The
  // `prevTree` carry-forward of the prior tree itself is already wired by
  // `layout-incremental.ts` / `dispatch.ts`; we forward its `plan` so the
  // measure pass restores `paginateRoot`'s old L-PERF-C O(1)-at-end behavior
  // instead of re-walking every page each keystroke.
  // `metas` are built over `groupChildren` (which flattens `display: contents`
  // elements), so the measure pass's child-fingerprint slices
  // (`PagePlanEntry.children`, `pageIndexOfBlock`, carry-forward reuse) must be
  // indexed over the SAME flattened child list — not raw `cascadedRoot.children`
  // — or a `display: contents` element at the root level desyncs the slice
  // index from the meta index.
  const plan = measurePass(
    metas, pageConfig, flattenContents(cascadedRoot.children), prevTree?.plan,
  );
  return makeVirtualLayoutTree(plan, cascadedRoot, ctx, shaper, pageConfig, prevTree);
}
