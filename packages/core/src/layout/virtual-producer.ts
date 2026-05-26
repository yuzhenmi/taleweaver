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
import type { BlockId } from "../state";
import type { LayoutContext } from "./layout-context";
import type { TextShaper } from "./text-shaper";
import type { PageConfig } from "./page-config";
import { buildBlockFitMetas } from "./build-fit-metas";
import { measurePass, type SlotInsets } from "./measure-pass";
import { buildSectionPlan, type SectionPlan } from "./section-plan";
import { flattenContents } from "./group-children";
import { layoutBlock } from "./bfc";
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
 * @param cascadedTemplateContents cascaded header/footer template bodies (C.2c),
 *   keyed by body root BlockId; threaded into `makeVirtualLayoutTree`'s closure
 *   so `materializePage` can lay them into each page's header/footer slot (T4
 *   consumes it). Defaults to an empty map (no header/footer bodies).
 */
export function buildVirtualPaginatedTree(
  cascadedRoot: ElementBox,
  ctx: LayoutContext,
  shaper: TextShaper,
  pageConfig: PageConfig,
  prevTree?: VirtualLayoutTree,
  cascadedTemplateContents: ReadonlyMap<BlockId, ElementBox> = new Map(),
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
  // Section page breaks (C.2b-1): build the SectionPlan from the UNFLATTENED
  // cascaded root (sections self-identify via the `metadata.blockType ===
  // "section"` marker; no extra params). The measure pass forces a page break
  // before the flattened child that begins each new section. A section-less doc
  // yields `[{0, null}]` ⇒ no breaks ⇒ unchanged pagination. `prevTree?.plan`
  // carries the prior `sectionPlan` (now a required field) for the reuse gate.
  const sectionPlan = buildSectionPlan(cascadedRoot, pageConfig);
  // Per-section effective slot insets (#328 growing slot): lay each section's
  // cascaded header/footer body at that section's own effective content
  // inline-size, take its NATURAL (uncapped) height, and `max` against the raw
  // page margins. A header taller than its margin band thus PUSHES the body down
  // (and the footer pushes up). A section with no header/footer (the common
  // case) leaves the map absent for it ⇒ `measurePass` falls back to raw
  // margins ⇒ byte-identical pagination.
  const slotInsets = computeSlotInsets(
    sectionPlan, pageConfig, ctx, shaper, cascadedTemplateContents,
  );
  const plan = measurePass(
    metas, pageConfig, sectionPlan, flattenContents(cascadedRoot.children), prevTree?.plan, slotInsets,
  );
  return makeVirtualLayoutTree(
    plan, cascadedRoot, ctx, shaper, pageConfig, prevTree, cascadedTemplateContents,
  );
}

/**
 * Compute each section's effective slot insets (#328 growing slot), keyed by the
 * section's id (`null` for the implicit leading run) — the SAME key
 * `sectionStateAt` returns and `measurePass` looks up. For every section boundary
 * that declares a header and/or footer body present in `cascadedTemplateContents`:
 *
 *   - Lay the body out at THAT section's effective content inline-size (derived
 *     from the boundary's `pageConfig ?? docWidePageConfig` — so a landscape
 *     section's header wraps at its own width — minus the inline margins), with
 *     `availableBlockSize: MAX_SAFE_INTEGER` so the body is laid at its NATURAL
 *     height (never page-broken, never clipped). Read `.box?.blockSize ?? 0`.
 *   - `top = max(margin.blockStart, headerHeight)`,
 *     `bottom = max(margin.blockEnd, footerHeight)`.
 *
 * A boundary whose top and bottom both reduce to the raw margins (no header/
 * footer body) is OMITTED from the map — `measurePass`'s `?? margin` fallback
 * handles it identically, and omitting keeps the no-slot path allocation-light.
 *
 * **Memo (perf):** a `WeakMap<bodyRef, Map<inlineSize, blockSize>>` caches a
 * body's laid-out height per inline-size. The incremental cascade returns the
 * SAME body `ElementBox` ref when the body is unchanged, so a main-body keystroke
 * is a pure cache hit (0 layouts); only a header/footer edit (new body ref) pays
 * one layout. A fresh per-cycle WeakMap is sufficient since it bounds work to ≤1
 * layout per distinct (body, inlineSize) pair per cycle.
 */
function computeSlotInsets(
  sectionPlan: SectionPlan,
  docWide: PageConfig,
  ctx: LayoutContext,
  shaper: TextShaper,
  cascadedTemplateContents: ReadonlyMap<BlockId, ElementBox>,
): SlotInsets {
  // No bodies at all ⇒ no section can grow a slot ⇒ skip the work entirely and
  // let measurePass fall back to raw margins for every section.
  if (cascadedTemplateContents.size === 0) return new Map();

  // Per-cycle memo: body ref → (effective content inline-size → natural height).
  const heightMemo = new WeakMap<ElementBox, Map<number, number>>();
  const naturalHeight = (body: ElementBox, effContentInlineSize: number): number => {
    let perInline = heightMemo.get(body);
    if (perInline === undefined) {
      perInline = new Map();
      heightMemo.set(body, perInline);
    }
    const cached = perInline.get(effContentInlineSize);
    if (cached !== undefined) return cached;
    // Build the section's content LayoutContext exactly as `materializePage`
    // does (containingInlineSize = the content area). Lay the body at its
    // natural height (no clip, no page-break).
    const sectionContentCtx: LayoutContext = { ...ctx, containingInlineSize: effContentInlineSize };
    const { box } = layoutBlock(body, 0, 0, sectionContentCtx, shaper, {
      availableBlockSize: Number.MAX_SAFE_INTEGER,
      pageIndex: 0,
      resumeFrom: null,
    });
    const height = box?.blockSize ?? 0;
    perInline.set(effContentInlineSize, height);
    return height;
  };

  const insets = new Map<BlockId | null, { top: number; bottom: number }>();
  for (const boundary of sectionPlan.boundaries) {
    const effCfg = boundary.pageConfig ?? docWide;
    const effContentInlineSize =
      effCfg.pageInlineSize - effCfg.pageMargins.inlineStart - effCfg.pageMargins.inlineEnd;

    const headerBody =
      boundary.headerBlockId !== undefined
        ? cascadedTemplateContents.get(boundary.headerBlockId)
        : undefined;
    const footerBody =
      boundary.footerBlockId !== undefined
        ? cascadedTemplateContents.get(boundary.footerBlockId)
        : undefined;

    const headerHeight = headerBody !== undefined ? naturalHeight(headerBody, effContentInlineSize) : 0;
    const footerHeight = footerBody !== undefined ? naturalHeight(footerBody, effContentInlineSize) : 0;

    const top = Math.max(effCfg.pageMargins.blockStart, headerHeight);
    const bottom = Math.max(effCfg.pageMargins.blockEnd, footerHeight);

    // Omit a boundary whose insets both reduce to the raw margins — the
    // measurePass fallback produces the identical values, so storing them is
    // redundant (and keeps the no-slot path map small).
    if (top === effCfg.pageMargins.blockStart && bottom === effCfg.pageMargins.blockEnd) {
      continue;
    }
    // Key by the section's id (NOT the body id) — the value `sectionStateAt`
    // returns as `activeSectionId` and `measurePass` looks up. `null` for the
    // implicit leading run.
    insets.set(boundary.sectionId, { top, bottom });
  }
  return insets;
}
