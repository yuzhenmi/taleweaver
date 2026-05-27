// packages/core/src/layout/virtual-layout-tree.ts
//
// Virtualized-layout Phase 2. The on-demand page-materialization machinery.
//
// A `VirtualLayoutTree` carries the `PagePlan` (from Phase-1 `measurePass`) plus
// a memoizing `getPage(i)` that positions ONE page on demand by running the
// SAME per-page `layoutBlock` recipe `paginateRoot` runs — seeded from the
// plan's `resumeInto` token (NOT from a sequential previous-page break). This is
// the property virtualization depends on: any page can be positioned in
// isolation, identically to the sequential paginator.
//
// `getPage(i)` deep-equals `paginateRoot`'s page `i`; `materializeAll()`
// deep-equals `paginateRoot`'s whole tree. The equivalence suite
// (`virtual-layout-tree.test.ts`) guards this against any drift — `paginateRoot`
// is the oracle.
//
// **Unwired** (like Phase 1): `layoutTreeIncremental` is NOT changed; no
// consumer is touched. Wiring + controller migration are Phase 3.
//
// Design: docs/superpowers/specs/2026-05-24-virtualized-layout-design.md
// Plan:   docs/superpowers/plans/2026-05-24-virtualized-layout-phase2.md

import type { ElementBox } from "../render/render-node";
import type { BlockId } from "../state";
import type { LayoutContext } from "./layout-context";
import type { TextShaper } from "./text-shaper";
import type { PageConfig } from "./page-config";
import type { BlockBox, LayoutBox } from "./layout-box-v2";
import { createBlockBox } from "./layout-box-v2";
import type { PageBox } from "./page-box";
import { createPageBox } from "./page-box";
import { layoutBlock } from "./bfc";
import { computeUsedStyle } from "./used-style";
import type { ComputedStyle, UsedStyle } from "../styles";
import type { PagePlan, PagePlanEntry } from "./measure-pass";
import type { BreakToken } from "./fragmentation";
import { pageConfigsEqual } from "./section-plan";

/**
 * A virtualized layout result. Discriminated from the legacy positioned
 * `LayoutBox` by `type: "virtual-root"`. Holds the `PagePlan` and lazily
 * materializes positioned `PageBox`es on demand.
 */
export interface VirtualLayoutTree {
  readonly type: "virtual-root";
  readonly plan: PagePlan;
  /** Document inline-size (== plan.pageInlineSize). */
  readonly inlineSize: number;
  /** Document block-size (== plan.totalBlockSize). */
  readonly blockSize: number;
  /** Position + memoize page `pageIndex`. Out-of-range throws. */
  getPage(pageIndex: number): PageBox;
  /** `getPage(from..to)`, inclusive, clamped to `[0, lastPage]`. */
  getPages(from: number, to: number): PageBox[];
  /**
   * Build the legacy outer `BlockBox` whose children are `getPage(0..N-1)`,
   * sized exactly as `paginateRoot`'s outer box. Lets Phase-2 consumers/tests
   * that expect the positioned tree run unchanged.
   */
  materializeAll(): BlockBox;
}

// ---------------------------------------------------------------------------
// Test-only instrumentation: count per-page `layoutBlock` DRIVER invocations.
//
// `getPage` invokes `layoutBlock(root, …)` exactly once per page it positions
// (the top-level per-page driver call — recursion into children is internal).
// The Phase-2 guard test asserts that calling only `getPage(19)` on a 20-page
// tree drives layout ONCE, not 20 times — i.e. positioning page 19 does NOT
// position pages 0–18. Production code pays one integer increment per page it
// actually materializes.
// ---------------------------------------------------------------------------

let _getPageDriverCount = 0;

/** Test-only: number of per-page `layoutBlock` driver calls since last reset. */
export function __getGetPageDriverCountForTest(): number {
  return _getPageDriverCount;
}

/** Test-only: reset the driver-call counter. */
export function __resetGetPageDriverCountForTest(): void {
  _getPageDriverCount = 0;
}

/**
 * The per-page fingerprint used by the carry-forward memo. Two pages with
 * structurally-equal fingerprints render identically, so an unchanged page from
 * a prior tree can be returned by reference (preserving paint-cache + LineIndex
 * warmth). Includes the page's EFFECTIVE geometry (`pageConfig`) so a resize or a
 * per-section geometry override never reuses a PageBox laid out at the old
 * geometry, and `listCounterAtStart` so an ordered-list seed change (which
 * changes marker text) is never reused stale.
 */
interface PageFingerprint {
  readonly children: readonly unknown[]; // cascaded child refs (reference identity)
  readonly resumeInto: BreakToken | null;
  readonly resumeOut: BreakToken | null;
  readonly blockOffset: number;
  readonly listCounterAtStart: number;
  /**
   * The EFFECTIVE per-page geometry this page was POSITIONED with (C.2b-2):
   * `PagePlanEntry.pageConfig` (the active section's override, or the doc-wide
   * config). The WHOLE config participates — not just `pageInlineSize` +
   * content-block-size — because two configs can share content-block-size yet
   * differ in margins or page-block-size, producing a DIFFERENT PageBox height
   * and DIFFERENT BFC child offsets. Compared via `pageConfigsEqual` (deep
   * field+margins compare; references differ across measure cycles). A
   * section-geometry change thus invalidates exactly that section's pages while
   * earlier sections (unchanged config) still carry forward.
   */
  readonly pageConfig: PageConfig;
  /**
   * The section page-break cap this page was POSITIONED with (see
   * `PagePlanEntry.stopBeforeIndex`). MUST participate in the fingerprint:
   * `materializePage` threads it into `bfc.layoutBlock`, so two entries with
   * identical children/resume tokens but DIFFERENT caps produce DIFFERENT
   * PageBoxes (one truncated at the section boundary, one not). A SECTION_BREAK
   * that creates/moves a boundary leaves a page's body refs unchanged but flips
   * its cap (e.g. null → N); without this field the carry-forward memo would
   * reuse the prior UNCAPPED PageBox and re-leak the next section's blocks onto
   * this page on the next edit cycle.
   */
  readonly stopBeforeIndex: number | null;
  /**
   * The header / footer template-body ids this page's slots were laid out from
   * (C.2c T4): `PagePlanEntry.headerBlockId` / `.footerBlockId`. `undefined`
   * when the active section/doc declares no header/footer. MUST participate so a
   * section header-id change (a SECTION_BREAK that flips the active header) re-
   * materializes the page even when its body content + resume tokens are
   * unchanged.
   */
  readonly headerBlockId: BlockId | undefined;
  readonly footerBlockId: BlockId | undefined;
  /**
   * The cascaded header / footer body REFERENCE (`templateBodies.get(id)`).
   * `undefined` when there is no id or no body for it. Reference identity is the
   * change signal: a header edit produces a NEW cascaded ElementBox for the same
   * id, so the body ref differs → re-materialize; an unchanged body carried
   * forward across measure cycles keeps the same ref → reuse. (The body lives
   * OUTSIDE `entry.children`, so without these fields a header-only edit would
   * leave the page fingerprint identical and wrongly reuse the stale slot.)
   */
  readonly headerBody: ElementBox | undefined;
  readonly footerBody: ElementBox | undefined;
  /**
   * The effective slot insets this page was POSITIONED with (#328 growing slot):
   * `PagePlanEntry.effectiveTopInset` / `.effectiveBottomInset`. DEFENSIVE-
   * REDUNDANT today — the insets are a pure function of the header/footer body
   * refs + the page geometry, both of which already participate in the
   * fingerprint, so a body-height change always flips `headerBody` / `footerBody`
   * / `pageConfig` too. Included so the fingerprint stays correct if a future
   * inset source (e.g. an explicit per-section inset attr independent of the body
   * height) is added, and so it is not deleted as dead. Two pages with identical
   * body refs + geometry have identical insets ⇒ this never blocks a valid reuse.
   */
  readonly effectiveTopInset: number;
  readonly effectiveBottomInset: number;
}

/** Structural break-token equality (references differ across measure cycles). */
function breakTokensEqual(a: BreakToken | null, b: BreakToken | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.type !== b.type) return false;
  if (a.type === "block" && b.type === "block") {
    return a.resumeChildIndex === b.resumeChildIndex && breakTokensEqual(a.resumeChildToken, b.resumeChildToken);
  }
  if (a.type === "ifc" && b.type === "ifc") return a.resumeAtLine === b.resumeAtLine;
  if (a.type === "table" && b.type === "table") return a.resumeAtRow === b.resumeAtRow;
  return false;
}

function childrenRefsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Local copy of the dev-mode flag (mirrors `layout-box-v2.ts`'s
 * `isDevModeForBox`): the layout module avoids importing the state module's
 * `dev-mode.ts` to keep the layer's dependency graph clean. Reads `process.env`
 * defensively because the engine compiles for browsers (no `process` global).
 * Used only to gate the slot-cap invariant assert in `materializePage`.
 */
function isDevModeForVirtualLayout(): boolean {
  const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
  return proc?.env?.NODE_ENV !== "production";
}

function fingerprintsEqual(a: PageFingerprint, b: PageFingerprint): boolean {
  return (
    a.blockOffset === b.blockOffset &&
    a.listCounterAtStart === b.listCounterAtStart &&
    pageConfigsEqual(a.pageConfig, b.pageConfig) &&
    a.stopBeforeIndex === b.stopBeforeIndex &&
    a.headerBlockId === b.headerBlockId &&
    a.footerBlockId === b.footerBlockId &&
    a.headerBody === b.headerBody &&
    a.footerBody === b.footerBody &&
    a.effectiveTopInset === b.effectiveTopInset &&
    a.effectiveBottomInset === b.effectiveBottomInset &&
    childrenRefsEqual(a.children, b.children) &&
    breakTokensEqual(a.resumeInto, b.resumeInto) &&
    breakTokensEqual(a.resumeOut, b.resumeOut)
  );
}

/**
 * Build a `VirtualLayoutTree` from a `PagePlan` and the cascaded document root.
 * Replicates `paginateRoot`'s setup ONCE (margins, root used style, content
 * context); `getPage(i)` then positions page `i` lazily by running the same
 * per-page `layoutBlock` recipe seeded from `plan.entries[i].resumeInto`.
 *
 * @param prevTree optional prior tree for carry-forward memo: an unchanged page
 *   (same fingerprint) whose prior PageBox was materialized is returned by
 *   reference, preserving paint-cache + LineIndex warmth.
 * @param cascadedTemplateContents cascaded header/footer template bodies (C.2c),
 *   keyed by body root BlockId. Captured in the closure so `materializePage`
 *   can resolve a page's header/footer body and lay it into the page's slot.
 *   T3 only STORES it (no read site yet); T4 consumes it. Defaults to an empty
 *   map so a no-header/footer doc is byte-identical.
 */
export function makeVirtualLayoutTree(
  plan: PagePlan,
  cascadedRoot: ElementBox,
  ctx: LayoutContext,
  shaper: TextShaper,
  pageConfig: PageConfig,
  prevTree?: VirtualLayoutTree,
  cascadedTemplateContents: ReadonlyMap<BlockId, ElementBox> = new Map(),
): VirtualLayoutTree {
  const margins = pageConfig.pageMargins;
  const pageContentBlockSize =
    pageConfig.pageBlockSize - margins.blockStart - margins.blockEnd;
  const pageContentInlineSize =
    pageConfig.pageInlineSize - margins.inlineStart - margins.inlineEnd;

  if (pageContentBlockSize <= 0) {
    throw new Error(
      `makeVirtualLayoutTree: pageMargins.blockStart (${margins.blockStart}) + pageMargins.blockEnd (${margins.blockEnd}) must be less than pageBlockSize (${pageConfig.pageBlockSize}).`,
    );
  }
  if (pageContentInlineSize <= 0) {
    throw new Error(
      `makeVirtualLayoutTree: pageMargins.inlineStart (${margins.inlineStart}) + pageMargins.inlineEnd (${margins.inlineEnd}) must be less than pageInlineSize (${pageConfig.pageInlineSize}).`,
    );
  }
  if (!cascadedRoot.computedStyle) {
    throw new Error("makeVirtualLayoutTree: root must be cascaded (computedStyle missing)");
  }

  // paginate.ts:162–169 — compute the root's UsedStyle once; per-page layout
  // uses the content area (page minus margins) as the BFC's containing inline
  // size, with the BFC positioned at (margins.inlineStart, margins.blockStart).
  const rootComputed: ComputedStyle = cascadedRoot.computedStyle;
  const rootUsedStyle: UsedStyle = computeUsedStyle(rootComputed, pageConfig.pageInlineSize, "indefinite");
  const contentCtx: LayoutContext = { ...ctx, containingInlineSize: pageContentInlineSize };

  // C.2c (T3): the cascaded header/footer template bodies, captured in the
  // closure keyed by body root BlockId. `materializePage` will resolve a page's
  // header/footer body from this map and lay it into the page's slot (T4
  // consumes it; T3 only stores + exposes it). Exposed as a non-enumerable hook
  // below so it stays out of the public contract surface but remains
  // inspectable for tests and reachable by the T4 read site.
  const templateBodies = cascadedTemplateContents;

  // C.2c (T4): the per-page fingerprint. MOVED into the closure (from top level)
  // so it can resolve a page's header/footer body REFERENCE off `templateBodies`
  // — the slot's change signal. The cross-tree compare in `getPage` works
  // because the PREVIOUS tree's fingerprints were computed by ITS OWN closure
  // (its own `templateBodies`) and `thisFp` by this tree's: a re-cascaded body
  // (new ref) makes them differ → re-materialize; an unchanged carried-forward
  // body (same ref) → reuse. `fingerprintAt` (below, also in the closure) binds
  // to this same `fingerprintOf` automatically.
  function fingerprintOf(entry: PagePlanEntry): PageFingerprint {
    const headerBlockId = entry.headerBlockId;
    const footerBlockId = entry.footerBlockId;
    return {
      children: entry.children,
      resumeInto: entry.resumeInto,
      resumeOut: entry.resumeOut,
      blockOffset: entry.blockOffset,
      listCounterAtStart: entry.listCounterAtStart,
      pageConfig: entry.pageConfig,
      stopBeforeIndex: entry.stopBeforeIndex,
      headerBlockId,
      footerBlockId,
      headerBody: headerBlockId !== undefined ? templateBodies.get(headerBlockId) : undefined,
      footerBody: footerBlockId !== undefined ? templateBodies.get(footerBlockId) : undefined,
      effectiveTopInset: entry.effectiveTopInset,
      effectiveBottomInset: entry.effectiveBottomInset,
    };
  }

  // Lazy per-index memo of materialized pages. Populated on first getPage(i).
  const pageMemo = new Map<number, PageBox>();

  // Carry-forward setup: snapshot the prev tree's per-page fingerprints so we
  // can compare in getPage. We only reuse a prev page if it was actually
  // materialized — the non-materializing probe below checks that.
  const prevInternal = prevTree as VirtualLayoutTreeInternal | undefined;
  const prevFingerprints: (PageFingerprint | undefined)[] = [];
  if (prevInternal !== undefined && prevInternal.__fingerprintAt !== undefined) {
    for (const e of prevInternal.plan.entries) {
      prevFingerprints[e.pageIndex] = prevInternal.__fingerprintAt(e.pageIndex);
    }
  }

  function getPage(pageIndex: number): PageBox {
    const memoized = pageMemo.get(pageIndex);
    if (memoized !== undefined) return memoized;

    const entry = plan.entries[pageIndex];
    if (entry === undefined) {
      throw new Error(
        `VirtualLayoutTree.getPage: page index ${pageIndex} out of range (0..${plan.entries.length - 1})`,
      );
    }

    // Carry-forward memo (lazy): if the prior tree has a structurally-identical
    // fingerprint for this page AND that page was actually materialized, reuse
    // its PageBox by reference (paint-cache + LineIndex warmth preserved).
    if (prevInternal !== undefined && prevInternal.__peekMaterializedPage !== undefined) {
      const prevFp = prevFingerprints[pageIndex];
      const thisFp = fingerprintOf(entry);
      if (prevFp !== undefined && fingerprintsEqual(prevFp, thisFp)) {
        const reused = prevInternal.__peekMaterializedPage(pageIndex);
        if (reused !== undefined) {
          pageMemo.set(pageIndex, reused);
          return reused;
        }
      }
    }

    const page = materializePage(pageIndex, entry);
    pageMemo.set(pageIndex, page);
    return page;
  }

  function materializePage(pageIndex: number, entry: PagePlanEntry): PageBox {
    // Per-entry effective geometry (C.2b-2): this page is positioned with its
    // OWN `pageConfig` — the active section's geometry override (or the doc-wide
    // config when it carries none). For a no-override doc every entry's
    // `pageConfig` IS the doc-wide config (same fields), so the values below
    // equal the closure-captured ones.
    const effCfg = entry.pageConfig;
    const effMargins = effCfg.pageMargins;
    // Effective slot insets for THIS page (#328 growing slot): the body content
    // area is `[effectiveTopInset, pageBlockSize − effectiveBottomInset]` — the
    // header grows the top inset, the footer grows the bottom one. For a no-slot
    // page the insets equal the raw margins (the measure pass's `?? margin`
    // fallback), so the values below reduce to the raw-margin content area.
    const effTopInset = entry.effectiveTopInset;
    const effBottomInset = entry.effectiveBottomInset;
    const effContentBlockSize =
      effCfg.pageBlockSize - effTopInset - effBottomInset;
    // Slot-cap invariant (#329), mirroring measurePass: the producer's
    // `computeSlotInsets` pre-caps the per-section insets so the body content
    // area always retains ≥ minBody. This branch is therefore UNREACHABLE for
    // producer-built plans; it is kept as a dev-only invariant assert (not a
    // hard prod throw) because a DIRECTLY-built plan bypasses the producer cap —
    // the invariant stays visible in tests/dev without crashing production.
    if (isDevModeForVirtualLayout() && effContentBlockSize <= 0) {
      throw new Error(
        `materializePage: header/footer insets (top=${effTopInset}, bottom=${effBottomInset}) ` +
          `leave no body content area within pageBlockSize=${effCfg.pageBlockSize} — the slot ` +
          `should have been capped by the producer (see #329).`,
      );
    }
    const effContentInlineSize =
      effCfg.pageInlineSize - effMargins.inlineStart - effMargins.inlineEnd;

    // Root used-style + content context per page, but PRESERVE byte-identity for
    // uniform (doc-wide) pages: when this page's inline-size matches the doc-wide
    // config, reuse the SAME closure objects (`rootUsedStyle` / `contentCtx`),
    // so the equivalence harness (every page resolves to docWide) stays
    // byte-identical to `paginateRoot`. Only an inline-overriding section
    // recomputes them (its root used-style + containing inline-size differ).
    const sameInline = effCfg.pageInlineSize === pageConfig.pageInlineSize;
    const effRootUsedStyle: UsedStyle = sameInline
      ? rootUsedStyle
      : computeUsedStyle(rootComputed, effCfg.pageInlineSize, "indefinite");
    const effContentCtx: LayoutContext = sameInline
      ? contentCtx
      : { ...ctx, containingInlineSize: effContentInlineSize };

    // NOTE: an earlier version threaded a per-page `prevLayoutCache` built from
    // the prior tree's PageBox (buildLayoutBoxCacheFromTree(prevPage, …)) so
    // unchanged blocks WITHIN a re-materialized page reused their prior boxes
    // (intra-page L-PERF-A/-G). That was REMOVED — it reused a moved block's
    // box at its STALE position (e.g. Enter at the start of a line left the
    // text painted on the old line: the cache returned the text box at its
    // pre-edit blockOffset instead of repositioning it). Re-materializing one
    // visible page from scratch is cheap (the measure pass already decided the
    // boundaries; this just positions ~one page of blocks). A correct
    // intra-page reuse can be reinstated later (see the tracked follow-up), but
    // correctness comes first. `getPage` runs the SAME per-page driver call
    // paginateRoot runs (paginate.ts:213–220), seeded from the PLAN's
    // resumeInto — NOT a sequential previous-page break.
    _getPageDriverCount++;
    const { box } = layoutBlock(
      cascadedRoot,
      effMargins.inlineStart,
      // Body origin (#328): the EFFECTIVE top inset, not the raw margin — a tall
      // header has grown `effectiveTopInset` past `blockStart`, pushing the body
      // down. For a no-slot page this equals `effMargins.blockStart`.
      effTopInset,
      effContentCtx,
      shaper,
      {
        availableBlockSize: effContentBlockSize,
        pageIndex,
        resumeFrom: entry.resumeInto,
        // Section cap (C.2b-1): honor the SAME `stopBeforeIndex` the plan's
        // `fitOnePage` applied to this page, so positioning stops before the
        // next section's leading block instead of greedily filling the leftover
        // room with it. `null` (no next boundary) ⇒ `undefined` ⇒ no cap.
        stopBeforeIndex: entry.stopBeforeIndex ?? undefined,
      },
    );
    // Wrap exactly as paginate.ts:226–237. The BFC BlockBox can be null
    // (no content fit) — guard it. blockOffset is the plan's RUNNING SUM over
    // the per-page heights before this one (no longer pageIndex*(H+gap), since
    // a section may override its geometry). The PageBox block-size is the
    // SECTION's effective page block-size, not the content size.
    const children: readonly LayoutBox[] = box ? [box] : [];

    // C.2c (T4) + #328 (growing slot): lay the page's header/footer template
    // bodies at their NATURAL height — never clipped. Each is a single-shot
    // `layoutBlock` of the cascaded body at the content inline-offset, with
    // `availableBlockSize: MAX_SAFE_INTEGER` so the body lays out fully (no
    // clip, no page-break). A header taller than its margin band GROWS the top
    // inset (`effectiveTopInset`) and PUSHES the body content down (computed in
    // the producer's `computeSlotInsets`, threaded via the entry); the footer
    // grows the bottom inset and is anchored so it ends at the page bottom.
    // (I4: passing MAX_SAFE_INTEGER is safe — bfc/ifc use `availableBlockSize`
    // only in subtractions + one fit comparison, never to size the box.)
    // It is NOT paginated: `resumeFrom: null` and no `stopBeforeIndex`. `pageIndex`
    // is passed because `FragmentationContext` requires it; it is behaviorally
    // inert for the slot's OWN layout (the slot context carries
    // `prevLayoutCache: null`, so the paginated-reuse path is never entered). The
    // slot is null when the entry carries no id, or no body matches the id.
    // Header origin is `(inlineStart, 0)` (slot grows DOWN from the page top);
    // footer origin is `(inlineStart, pageBlockSize − effectiveBottomInset)` so
    // a natural-height footer ends exactly at the page bottom (slot grows UP).
    const layoutSlot = (
      blockId: BlockId | undefined,
      slotBlockStart: number,
    ): BlockBox | null => {
      if (blockId === undefined) return null;
      const body = templateBodies.get(blockId);
      if (body === undefined) return null;
      const { box: slotBox } = layoutBlock(
        body,
        effMargins.inlineStart,
        slotBlockStart,
        effContentCtx,
        shaper,
        { availableBlockSize: Number.MAX_SAFE_INTEGER, pageIndex, resumeFrom: null },
      );
      return slotBox;
    };
    const headerSlot = layoutSlot(entry.headerBlockId, 0);
    const footerSlot = layoutSlot(
      entry.footerBlockId,
      effCfg.pageBlockSize - effBottomInset,
    );

    return createPageBox(
      `page-${pageIndex}`,
      0, entry.blockOffset,
      effCfg.pageInlineSize, effCfg.pageBlockSize,
      ctx.writingMode, ctx.direction,
      rootComputed, effRootUsedStyle,
      children,
      pageIndex,
      effCfg.pageInlineSize,
      headerSlot, footerSlot,
      // #332 region-classification edges: body content area is
      // [effTopInset, pageBlockSize − effBottomInset]; the margins outside
      // are the header/footer zones. On a #328 growing slot these exceed the
      // raw margins; on a plain page they equal the page's content margins.
      effTopInset, effBottomInset,
    );
  }

  function getPages(from: number, to: number): PageBox[] {
    const last = plan.entries.length - 1;
    const lo = Math.max(0, Math.min(from, last));
    const hi = Math.max(0, Math.min(to, last));
    const pages: PageBox[] = [];
    for (let i = lo; i <= hi; i++) pages.push(getPage(i));
    return pages;
  }

  function materializeAll(): BlockBox {
    // Mirror paginate.ts:295–305. The total document height is the plan's
    // RUNNING SUM over per-page heights (C.2b-2) — pages are no longer
    // uniform-height once a section overrides its geometry, so we use
    // `plan.totalBlockSize` directly rather than a `pageCount × H + gaps`
    // formula (which would be wrong for a mixed-height doc; for a no-override
    // doc the running sum reduces to exactly that formula). The outer BlockBox
    // keeps the doc-wide inline-size (the bridge contract; removed in a later
    // phase).
    const pageCount = plan.entries.length;
    const pages: PageBox[] = [];
    for (let i = 0; i < pageCount; i++) pages.push(getPage(i));
    return createBlockBox(
      cascadedRoot.key, 0, 0,
      pageConfig.pageInlineSize, plan.totalBlockSize,
      ctx.writingMode, ctx.direction,
      rootComputed, rootUsedStyle,
      pages,
      pageConfig.pageInlineSize,
    );
  }

  // Non-materializing peek for the NEXT tree's carry-forward memo: returns this
  // page's PageBox iff it was already materialized; never triggers layout.
  function peekMaterializedPage(pageIndex: number): PageBox | undefined {
    return pageMemo.get(pageIndex);
  }

  // This tree's per-page fingerprint, for the NEXT tree's comparison. Uses each
  // entry's own EFFECTIVE `pageConfig` (C.2b-2), so a doc-wide resize OR a
  // per-section geometry change between trees is reflected in the fingerprint.
  function fingerprintAt(pageIndex: number): PageFingerprint | undefined {
    const entry = plan.entries[pageIndex];
    if (entry === undefined) return undefined;
    return fingerprintOf(entry);
  }

  // The public tree: only the contract surface as enumerable own properties.
  // The carry-forward hooks are attached non-enumerably below so they never
  // leak via Object.keys / for..in / JSON serialization, then the whole object
  // is frozen so a consumer can't mutate the layout result. The hooks remain
  // readable off `prevTree` (they're values, not enumerable) — that's the only
  // path that touches them.
  const tree = {
    type: "virtual-root",
    plan,
    inlineSize: plan.pageInlineSize,
    blockSize: plan.totalBlockSize,
    getPage,
    getPages,
    materializeAll,
  } as VirtualLayoutTreeInternal;
  Object.defineProperty(tree, "__peekMaterializedPage", {
    value: peekMaterializedPage,
    enumerable: false,
  });
  Object.defineProperty(tree, "__fingerprintAt", {
    value: fingerprintAt,
    enumerable: false,
  });
  Object.defineProperty(tree, "__cascadedTemplateContents", {
    value: templateBodies,
    enumerable: false,
  });
  Object.freeze(tree);
  return tree;
}

/**
 * Internal shape: the carry-forward hooks attached to every VirtualLayoutTree.
 * Not part of the public contract; only `makeVirtualLayoutTree` reads them off
 * a `prevTree` to drive the lazy carry-forward memo.
 */
interface VirtualLayoutTreeInternal extends VirtualLayoutTree {
  /** Already-materialized PageBox for `pageIndex`, or undefined if never materialized. Does NOT materialize. */
  readonly __peekMaterializedPage?: (pageIndex: number) => PageBox | undefined;
  /** This tree's fingerprint for `pageIndex` (uses this tree's geometry), or undefined if out of range. */
  readonly __fingerprintAt?: (pageIndex: number) => PageFingerprint | undefined;
  /**
   * The cascaded header/footer template bodies this tree was built with (C.2c),
   * keyed by body root BlockId. T3 stores it here (no read site yet); T4's
   * `materializePage` consumes it to lay bodies into each page's slot. Exposed
   * for test inspection of the threading.
   */
  readonly __cascadedTemplateContents?: ReadonlyMap<BlockId, ElementBox>;
}
