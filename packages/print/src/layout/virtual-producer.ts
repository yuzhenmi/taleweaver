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

import type { ElementBox } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import type { FootnoteAnchorRef } from "@taleweaver/core";
import type { LayoutContext } from "./layout-context";
import type { BlockParentLookup } from "./page-of-field-target";
import type { TextShaper } from "@taleweaver/core";
import type { Hyphenator } from "@taleweaver/core";
import type { PageConfig } from "./page-config";
import { buildBlockFitMetas } from "./build-fit-metas";
import {
  measurePass,
  hasFloatOrClear,
  type SlotInsets,
  type PagePlan,
  type FloatPageMeasurer,
} from "./measure-pass";
import { accumulateListCounter } from "./fit-core";
import { buildSectionPlan, type SectionPlan } from "./section-plan";
import { flattenContents } from "./group-children";
import { createFloatEnvironment } from "./float-context";
import { layoutBlock, placeIncomingPushedFloats } from "./bfc";
import { adaptShaperToMeasurer } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { collectPageFields } from "./collect-page-fields";
import { resolvePageFields } from "./resolve-page-fields";
import { patchFieldWidths, patchRootFieldWidths } from "./patch-field-widths";
import { runFieldConvergence, WIDTH_EPSILON, type ConvergenceField } from "./field-convergence";
import { PAGE_FIELD_RESERVED_GLYPHS } from "@taleweaver/core";
import { isDevMode } from "@taleweaver/core";
import { makeVirtualLayoutTree, type VirtualLayoutTree } from "./virtual-layout-tree";
import {
  resolveFootnotes,
  buildBlockToTopLevelIndex,
  footnoteAnchorPageAssignment,
} from "./resolve-footnotes";

// R-F6: the shared empty body-width sentinel — returned by `mergeBodyWidths` for a
// field-free doc so the common (no-main-body-field) path allocates ZERO per iteration
// and hands `makeVirtualLayoutTree` a ref-stable empty map (⇒ `patchRootFieldWidths`
// is a ref-equal no-op ⇒ `substitutedRoot === cascadedRoot`, byte-identical to the
// pre-feature path).
const EMPTY_FIELD_WIDTHS: ReadonlyMap<string, number> = new Map();

/**
 * Build a `VirtualLayoutTree` for a paginated `display: block` document root.
 *
 * Callers must already have gated on `!paginationFallsBackToLegacy(cascadedRoot,
 * footnoteAnchors)` (`position:absolute` docs and float docs that are also
 * multi-column or footnote-bearing fall back to the legacy positioned
 * `paginateRoot` path; single-column float/`clear` docs use this virtualized fast
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
 * @param cascadedEmbedContents cascaded footnote bodies (FN-1), keyed by body
 *   root BlockId. Consumed by the footnote layout pass (`resolveFootnotes`,
 *   FN-4.3): each anchor's body is laid into its page's footnote slot, reducing
 *   the body content area. Threaded on into `makeVirtualLayoutTree` so
 *   `materializePage` renders the slot. Defaults to an empty map (no footnotes).
 * @param footnoteAnchors ordered footnote anchors in the main document
 *   (`collectFootnoteAnchors`), consumed by `resolveFootnotes` (FN-4.3) to assign
 *   each footnote body to its page. Empty ⇒ `resolveFootnotes` is a ref-equal
 *   no-op (zero cost). Defaults to an empty array (no footnotes).
 * @param parentOf optional nested-cross-ref-target lookup threaded into
 *   `resolvePageFields` (block → parent block); absent ⇒ nested cross-ref
 *   targets resolve as broken-ref, unchanged from today.
 */
export function buildVirtualPaginatedTree(
  cascadedRoot: ElementBox,
  ctx: LayoutContext,
  shaper: TextShaper,
  pageConfig: PageConfig,
  prevTree?: VirtualLayoutTree,
  cascadedTemplateContents: ReadonlyMap<BlockId, ElementBox> = new Map(),
  cascadedEmbedContents: ReadonlyMap<BlockId, ElementBox> = new Map(),
  footnoteAnchors: readonly FootnoteAnchorRef[] = [],
  parentOf?: BlockParentLookup,
  // Auto-hyphenation (slice 2): threaded ALONGSIDE `shaper` to EVERY downstream
  // layout site — body `buildBlockFitMetas`, `computeSlotInsets`,
  // `resolveFootnotes`, and the per-page `makeVirtualLayoutTree` closure — so the
  // measure pass and the materialized pages share identical hyphenation inputs.
  // Trailing + optional so existing callers/tests stay valid. `undefined` ⇒ none.
  // Carried but UNUSED in this slice.
  hyphenator?: Hyphenator,
): VirtualLayoutTree {
  const margins = pageConfig.pageMargins;
  const pageContentInlineSize =
    pageConfig.pageInlineSize - margins.inlineStart - margins.inlineEnd;
  // VL float fast-path: the doc-wide content `LayoutContext` (narrowed to the page
  // content area) — the SAME object `makeVirtualLayoutTree` builds for a non-
  // overriding page (`{ ...ctx, containingInlineSize: pageContentInlineSize }`).
  // The float measurer (built per-iteration in `runIteration`) spreads it per page,
  // matching `materializePage`'s single-column `layoutBlock` context.
  const contentCtx: LayoutContext = { ...ctx, containingInlineSize: pageContentInlineSize };
  // VL float fast-path: gate the float measurer on the doc having any float/clear.
  // Float-free docs pass `undefined` to `measurePass` ⇒ the existing `fitOnePage`
  // path, byte-identical. A float doc only reaches this producer when
  // `paginationFallsBackToLegacy` returned false (single-column + footnote-free),
  // so the measurer is only ever invoked on single-column float pages — the
  // measure-pass multicol dev-assert never fires.
  const docHasFloat = hasFloatOrClear(cascadedRoot);

  const metas = buildBlockFitMetas(cascadedRoot, shaper, hyphenator, pageContentInlineSize);
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
  // Growth cap (#329): the body content area must always retain a MINIMUM
  // block size so a header/footer taller than the page cannot drive it ≤ 0
  // (which would otherwise CRASH the pipeline). The minimum is one body-root
  // line-height — measured ONCE here so `computeSlotInsets` stays pure
  // arithmetic. `cascadedRoot.computedStyle` is non-null by contract (callers
  // gate on `cascadedRoot.computedStyle?.display === "block"`); default to
  // `INITIAL_COMPUTED_STYLE` rather than risk a non-null assertion.
  const minBodyPx = adaptShaperToMeasurer(shaper).measureHeight(
    cascadedRoot.computedStyle ?? INITIAL_COMPUTED_STYLE,
  );
  // The flattened top-level children — sliced by both the measure pass (per-page
  // child fingerprints) AND `resolveFootnotes` (anchor→top-level-index mapping +
  // page child slices). Extracted ONCE and shared so the two passes index over
  // the identical array. Loop-invariant (page-field widths never change the body
  // structure), so it lives outside the convergence loop below.
  const rootChildren = flattenContents(cascadedRoot.children);
  // D6: the measure pass's carry-forward source is the prior tree's RAW
  // (pre-`resolveFootnotes`) plan — `resolveFootnotes` re-fits the footnote
  // pages, so comparing against the resolved plan would see spurious mismatches.
  // `?? prevTree?.plan` covers a footnote-free / pre-FN-4 prior tree (where the
  // raw and resolved plans are ref-equal anyway).
  const prevRawPlan =
    (prevTree as { __rawPlan?: PagePlan } | undefined)?.__rawPlan ?? prevTree?.plan;
  // FN-4.4 incremental carry-forward source (prior tree's resolved plan + cascaded
  // footnote bodies); see the resolveFootnotes call below. Loop-invariant.
  const prevInternal = prevTree as
    | { __cascadedEmbedContents?: ReadonlyMap<BlockId, ElementBox> }
    | undefined;

  // F-2/F-3 (layout-dependent fields): collect the page-field specs from the cascaded
  // render trees ONCE (the walk is width-independent). `materializePage` substitutes
  // each header/footer page-field placeholder with its per-page value before slot
  // layout (self-page page-number = pageIndex+1; global page-count = `globalFieldValues`).
  // Main-body page-fields are OUT of scope (spec §4.3) — `collectPageFields` still
  // emits harmless `host:"main"` specs (forward-compat for the page-ref/TOC downstream),
  // which neither the convergence loop (it filters to `host:"template"`) nor
  // substitution consumes. NOTE: `resolvePageFields` below builds `globalFieldValues`
  // for ALL page-count specs — main-body ones too — and that map is passed to
  // `substituteLayoutFields` on TEMPLATE bodies. That is SAFE because render keys are
  // `${blockId}/inline/${i}` and Y.Doc block ids are globally unique across trees, so a
  // main-tree key can never match a template-body node; the extra entries are silently
  // ignored. (A future page-ref/TOC that substitutes into the main tree will find those
  // entries already present — by design.)
  const measurer = adaptShaperToMeasurer(shaper);
  const fieldSpecs = collectPageFields(cascadedTemplateContents, rootChildren);
  // §4.8: main-body layout-dependent fields (page-mode cross-references) affect the
  // BODY's line-wrapping (unlike template fields, which only grow a header/footer slot),
  // so when any exist the convergence loop must rebuild the body `metas` from the
  // width-patched root each iteration. Absent (the common case) ⇒ `metas` are loop-
  // invariant ⇒ byte-identical to the pre-feature path.
  const hasMainBodyFields = fieldSpecs.some((s) => s.host === "main");
  // §4.4 convergence inputs: ALL fields participate in grow-and-retry. A TEMPLATE
  // (header/footer) field grows a slot (feeds `computeSlotInsets`); a MAIN-BODY field
  // (page-mode cross-reference) grows the host block's inline-block atom and re-wraps
  // the body (feeds `patchRootFieldWidths` → rebuilt `metas`). The driver is host-
  // agnostic: each field's reservation is its placeholder's natural width (the rendered
  // `PAGE_FIELD_RESERVED_GLYPHS` zeros at the cascaded atom's style).
  const reservedGlyphs = "0".repeat(PAGE_FIELD_RESERVED_GLYPHS);
  const convergenceFields: ConvergenceField[] = fieldSpecs.map((spec) => ({
    embedKey: spec.embedKey,
    reservedWidth: measurer.measureWidth(reservedGlyphs, spec.computedStyle),
  }));

  // R-F6: the reserved (2-glyph "00") width of each MAIN-BODY layout field, by render key.
  // Used to size the body cross-ref atom IDENTICALLY in the measure pass (patched root) and at
  // materialize (substituted root) — measure↔materialize agreement (else a narrower-than-reservation
  // value lets a page/column fit more than planned → cross-boundary content duplication).
  const mainBodyReservedWidths = new Map<string, number>();
  for (const spec of fieldSpecs) {
    if (spec.host === "main") {
      mainBodyReservedWidths.set(spec.embedKey, measurer.measureWidth(reservedGlyphs, spec.computedStyle));
    }
  }
  // Merge a per-iteration `grownWidths` with the base reserved widths → each main-body field's
  // CURRENT effective width (grown if the convergence loop grew it, else the 2-glyph reservation).
  // A field-free doc returns the ref-stable EMPTY sentinel (zero allocation per iteration).
  const mergeBodyWidths = (grownWidths: ReadonlyMap<string, number>): ReadonlyMap<string, number> => {
    if (mainBodyReservedWidths.size === 0) return EMPTY_FIELD_WIDTHS;
    const out = new Map<string, number>();
    for (const [key, reserved] of mainBodyReservedWidths) out.set(key, grownWidths.get(key) ?? reserved);
    return out;
  };

  // One layout pass at a given set of grown field-width reservations: re-derive the
  // slot insets (the ONLY place a page-field width matters), re-fit pages, resolve
  // footnotes, and resolve the page-field values. `patchFieldWidths` overrides the
  // placeholder inlineSize so `computeSlotInsets` sees the grown width; an empty
  // `grownWidths` (the common case) returns the templates unchanged ⇒ byte-identical
  // to a no-convergence build.
  const runIteration = (grownWidths: ReadonlyMap<string, number>) => {
    const patchedTemplates = patchFieldWidths(cascadedTemplateContents, grownWidths);
    // §4.8: when the MAIN body hosts a layout-dependent field, patch the body root's
    // field widths and rebuild `metas` from the patched root so the IFC line-wraps the
    // host block against the grown inline-block width. For a field-free body,
    // `patchedRoot === cascadedRoot` and `effectiveMetas === metas`.
    // The two track-width meta builder callbacks (below) ALSO size off `patchedRoot` so
    // every meta source (full-width primary, narrow-track multicol, footnote re-fit)
    // sizes the body cross-ref atom identically — measure↔materialize consistency.
    //
    // R-F6 caching note: `mergeBodyWidths` feeds the RESERVED (2-glyph) widths — a
    // NON-empty map — whenever the doc has any main-body field, even on pass 1 where
    // `grownWidths` is empty. So `patchRootFieldWidths` always spine-clones a fresh root
    // ref for a body-field doc, and `buildBlockFitMetas` (cached by `(ref, width, shaper)`)
    // MISSES the cache → a full body meta rebuild every build. This is deliberate: feeding
    // the reserved-or-grown widths (never empty when main-body fields exist) is exactly
    // what keeps measure↔materialize byte-identical (R-F6) — materialize patches the body
    // root with the SAME merged widths. The cost is correctness-neutral and bounded: one
    // body meta rebuild per build, ONLY for field-bearing docs (the field-free common path
    // hits the `cascadedRoot`/`metas` branch below and is untouched). Tracked perf
    // follow-up: memoize `buildBlockFitMetas` by width-map CONTENT (not patched-root ref)
    // so a re-derived-but-equal reserved-width patch re-hits — tied to the
    // substitute-driven-measure redesign that would also yield tight (non-reserved) widths.
    // R-F6: patch with the MERGED body widths (each main-body field's grown-or-RESERVED width),
    // so the measure pass sizes every body cross-ref atom at an EXPLICIT width byte-identical to
    // the one materialize will use (`mergeBodyWidths(grownWidths)` is threaded to
    // `makeVirtualLayoutTree` below). This eliminates the auto-`"00"`-vs-explicit sub-pixel risk:
    // a value narrower than its 2-glyph reservation no longer lets materialize fit more children
    // than measure planned (cross-page/column content duplication). Field-free ⇒ empty merged map
    // ⇒ `patchRootFieldWidths` returns `cascadedRoot` ref-equal ⇒ `effectiveMetas === metas`.
    const patchedRoot = hasMainBodyFields
      ? patchRootFieldWidths(cascadedRoot, mergeBodyWidths(grownWidths))
      : cascadedRoot;
    const effectiveMetas = hasMainBodyFields
      ? buildBlockFitMetas(patchedRoot, shaper, hyphenator, pageContentInlineSize)
      : metas;
    const slotInsets = computeSlotInsets(
      sectionPlan, pageConfig, ctx, shaper, hyphenator, patchedTemplates, minBodyPx,
    );
    // VL float fast-path (Task 5): the single-column float measurer. For a float
    // doc, every page is measured by running the REAL `layoutBlock` (the SAME call
    // `materializePage` makes) and discarding the geometry — so measure↔materialize
    // is equivalence-by-construction. The closure seeds a fresh per-page
    // `FloatEnvironment` from the carried incoming-float snapshot, lays the body at
    // the per-page origin (`a.inlineOrigin`/`a.blockOrigin` — PR2-B, NOT uniform
    // margins, so a growing header / section geometry override stays byte-identical
    // to materialize), and returns the plan outputs (break token, in-flow consumed,
    // child count, advanced list counter, the env's full placed-float snapshot).
    // Float-free docs pass `undefined` ⇒ the existing `fitOnePage` path, byte-
    // identical. `patchedRoot`/`effectiveMetas` (the body root + meta array the
    // measure pass sizes against — `=== cascadedRoot`/`metas` for a field-free body)
    // are closed over so the measure and materialize layout inputs agree.
    const floatPageMeasurer: FloatPageMeasurer | undefined = docHasFloat
      ? (a) => {
          const env = createFloatEnvironment();
          for (const f of a.incomingFloats) env.seedPlaced(f);
          const pageCtx: LayoutContext = { ...contentCtx, floatEnv: env, isBFCRoot: true };
          // #528 (T4): place the floats PUSHED from the prior page at this page's
          // content top, AFTER the active-shadow seed and BEFORE the body
          // `layoutBlock` — so the body flows around them. The positioned boxes
          // are DISCARDED (the measure pass only needs the env occupancy + the
          // box block-extent feeding the next-page carry); materialize keeps them.
          placeIncomingPushedFloats(
            a.incomingPushedFloats, env, pageCtx, patchedRoot, shaper, hyphenator, a.pageFlowBase,
          );
          const { box, breakToken, inFlowConsumed } = layoutBlock(
            patchedRoot,
            a.inlineOrigin,
            a.blockOrigin,
            pageCtx,
            shaper,
            hyphenator,
            {
              availableBlockSize: a.contentBlockSize,
              pageIndex: 0,
              resumeFrom: a.resumeInto,
              stopBeforeIndex: a.stopBeforeIndex,
              // #528: opt this VIRTUALIZED measure pass into float pushing (legacy
              // paginateRoot leaves it off). The pushed floats are read out via
              // `env.pushedFloats()` and carried to the next page.
              enableFloatPushing: true,
            },
            a.pageFlowBase,
          );
          // Mirror the oracle/paginateRoot break-token → childrenCount mapping: a
          // null token ⇒ the doc end (all remaining children consumed); a block
          // token ⇒ resume at its `resumeChildIndex`; any other token (inner-BFC)
          // ⇒ no whole-child progress (stays at `startIndex`).
          const nextStartIndex =
            breakToken === null
              ? patchedRoot.children.length
              : breakToken.type === "block"
                ? breakToken.resumeChildIndex
                : a.startIndex;
          // Advance the ordered-list counter over the WHOLE-children this page
          // consumed, the SAME way `fitOnePage` does (via `accumulateListCounter`),
          // so each entry's `listCounterAtStart` is path-independent (PR1-1).
          let listCounterAtEnd = a.listCounterAtStart;
          for (let i = a.startIndex; i < nextStartIndex; i++) {
            const m = effectiveMetas[i];
            if (m !== undefined) listCounterAtEnd = accumulateListCounter(m, listCounterAtEnd);
          }
          return {
            resumeOut: breakToken,
            inFlowConsumed: box !== null ? inFlowConsumed : 0,
            childrenCount: nextStartIndex - a.startIndex,
            listCounterAtEnd,
            // Snapshot the env's placed floats (incoming + this page's own, all
            // cumulative) — the env is discarded after this call.
            placedFloats: env.getPlacedFloats().slice(),
            // #528 (T4): the floats this page's BFC float branch deferred to the
            // next page (recorded via `env.pushFloat`). The page-loop carry threads
            // these into the next page's `incomingPushedFloats`, where
            // `placeIncomingPushedFloats` lands them at the content top. Snapshot —
            // the env is discarded after this call.
            pushedFloats: env.pushedFloats().slice(),
          };
        }
      : undefined;
    const rawPlan = measurePass(
      effectiveMetas, pageConfig, sectionPlan, rootChildren, prevRawPlan, slotInsets,
      // #494: the multicol branch rebuilds metas at each column's TRACK width so
      // the planned ColumnFit matches `materializePage`'s narrow-track layout.
      // `buildBlockFitMetas` is cached by `(elementBoxRef, width, shaperRef)`, so
      // repeated calls for the same width are O(1). The full-width `effectiveMetas`
      // (line above) stays the primary arg for single-column pages.
      (inlineSize) => buildBlockFitMetas(patchedRoot, shaper, hyphenator, inlineSize),
      // DORMANT (Task 3): `undefined` ⇒ existing `fitOnePage` path. Task 5 supplies
      // the gated `floatPageMeasurer` closure.
      floatPageMeasurer,
    );
    // FN-4.3 (D6): the footnote layout pass — lays each anchor's body into its page's
    // bottom slot, reduces the body content area, forward-sweeps the re-fit. Footnote-
    // free docs ⇒ ref-equal no-op (`plan === rawPlan`). FN-4.4 carry-forward reuses an
    // unchanged footnote page's re-layout (prior resolved plan + cascaded bodies are
    // the change signal). Runs inside the loop because a re-fit (more pages) changes
    // the footnote→page assignment.
    const plan = resolveFootnotes(
      rawPlan, effectiveMetas, sectionPlan, rootChildren,
      cascadedEmbedContents, footnoteAnchors, ctx, shaper, hyphenator, slotInsets, pageConfig,
      prevTree?.plan, prevInternal?.__cascadedEmbedContents ?? new Map(),
      // #499: the track-width meta builder so a footnote anchored in a multi-column
      // section re-fits its columns at the narrow TRACK width — matching
      // `materializePage`'s narrow-track layout (identical to the arg passed to
      // `measurePass` above). Without it the footnote pass plans at full width and
      // drifts (the #494 drift class, here in the footnote re-fit).
      (inlineSize) => buildBlockFitMetas(patchedRoot, shaper, hyphenator, inlineSize),
    );
    const resolved = resolvePageFields(plan, fieldSpecs, measurer, parentOf);
    return {
      pageCount: plan.entries.length,
      maxValueWidthByKey: resolved.maxValueWidthByKey,
      rawPlan,
      plan,
      globalFieldValues: resolved.globalFieldValues,
    };
  };

  // §4.4 bounded width-convergence. Grows any template field whose resolved value
  // overflows its reservation and re-runs the CHEAP measure passes (never `getPage`).
  // Common case (every value ≤ the 2-glyph reservation, < 100 pages): exactly one
  // pass, then the convergence check breaks. The loop iterates only when a value
  // crosses the reserved digit boundary.
  const { result, grownWidths, converged } = runFieldConvergence(convergenceFields, runIteration);
  const { rawPlan, plan, globalFieldValues } = result;
  // R-F6: the FINAL per-main-body-field effective widths (grown-or-reserved) the converged
  // measure pass used. Threaded to `makeVirtualLayoutTree` so materialize width-patches each
  // body cross-ref atom to the SAME width before substituting the real text — measure and
  // materialize size the atom byte-identically (no narrower-value cross-boundary drift). Empty
  // sentinel for a field-free doc ⇒ materialize is a ref-equal no-op.
  const mainBodyFieldWidths = mergeBodyWidths(grownWidths);
  // Dev invariant (§4.4): every value's width fits its final reservation. This is the
  // convergence condition itself, so on the converged path it holds by construction —
  // it is a TRIPWIRE guarding against a future refactor of the driver/patch wiring that
  // returns `converged: true` without the property actually holding. Uses the SAME
  // `WIDTH_EPSILON` the driver applies, so the two agree to the pixel. The non-converged
  // (bound/pin) case is the documented safe-over-reservation backstop, so it is skipped.
  if (isDevMode() && converged) {
    for (const field of convergenceFields) {
      const reserved = grownWidths.get(field.embedKey) ?? field.reservedWidth;
      const needed = result.maxValueWidthByKey.get(field.embedKey) ?? 0;
      if (needed > reserved + WIDTH_EPSILON) {
        throw new Error(
          `page-field convergence reported converged but value width ${needed} exceeds reservation ${reserved} for "${field.embedKey}"`,
        );
      }
    }
  }

  // FN-6.4 slice 1: each footnote body (`contentBlockId`) → the page index its
  // anchor REFERENCE marker RENDERS on, derived from the RESOLVED `plan` (NOT the
  // raw plan) + anchors. The marker is inline content of the anchor host block,
  // which is positioned by the resolved plan; footnote-slot reservation can EVICT
  // an anchor-bearing block to a later page than the raw plan placed it (a tall
  // preceding footnote shrinks a page and spills its trailing anchor over). Keying
  // on the host block's RESOLVED page span (`pageSpanOfBlock(...).first`) tracks
  // that eviction; the raw plan would group an evicted anchor on its pre-eviction
  // page, so `restart-per-page` numbering (FN-6.1) — which restarts per the
  // marker's page — would keep its stale sequence number on the page it actually
  // renders on (audit F2, spec 2026-06-10-f2-restart-per-page-resolved-anchor-page).
  // The host-block span always resolves, so a fully-deferred footnote body (whose
  // slot starts on a later page) does NOT desync the marker's page. Exposed on the
  // tree for the post-layout rebuild pipeline. Empty for a footnote-free doc.
  const footnoteAnchorPages =
    footnoteAnchors.length === 0
      ? new Map<BlockId, number>()
      : footnoteAnchorPageAssignment(
          footnoteAnchors,
          plan,
          buildBlockToTopLevelIndex(rootChildren),
        );

  // Pass the RESOLVED plan to materialize against, the cascaded footnote bodies
  // so `materializePage` renders the slot, and the RAW plan as `__rawPlan` for
  // the NEXT cycle's measurePass carry-forward (D6).
  return makeVirtualLayoutTree(
    plan, cascadedRoot, ctx, shaper, pageConfig, prevTree, cascadedTemplateContents,
    cascadedEmbedContents, rawPlan, footnoteAnchorPages, fieldSpecs, globalFieldValues,
    mainBodyFieldWidths, hyphenator,
    // #528: enable cross-page float pushing exactly when this doc went through the
    // float-aware measure pass (`docHasFloat` ⇒ the `floatPageMeasurer` closure ran),
    // so measure and materialize agree on page boundaries.
    docHasFloat,
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
 * **Growth cap (#329):** after computing the uncapped `top`/`bottom`, the slot
 * growth is capped so the body content area retains a MINIMUM block size
 * (`minBodyPx`, one body-root line-height) — a header/footer taller than the
 * page can no longer drive the body ≤ 0 (which would CRASH the pipeline).
 * `minBody` is clamped to the page's own usable band (`pageBlockSize −
 * marginTop − marginBottom`) so a degenerate page (margins alone exceeding the
 * page) still yields a non-negative budget — but that DEGENERATE-margins case
 * is independently caught by the doc-wide coarse guard, not softened here. When
 * a cap fires, the GROWTH-BEYOND-MARGIN is reduced PROPORTIONALLY (margins are
 * the floor; never capped below them), so a lone tall slot gets the whole
 * budget and a both-tall page splits it. The over-tall slot's body still lays
 * at its NATURAL height (the cap touches only the insets / body origin), so its
 * content visually OVERLAPS the body band (accepted v1; clean clip deferred).
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
  // Auto-hyphenation (slice 2): threaded ALONGSIDE `shaper` to the header/footer
  // body `layoutBlock`. `undefined` ⇒ none. Carried but UNUSED in this slice.
  hyphenator: Hyphenator | undefined,
  cascadedTemplateContents: ReadonlyMap<BlockId, ElementBox>,
  minBodyPx: number,
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
    const { box } = layoutBlock(body, 0, 0, sectionContentCtx, shaper, hyphenator, {
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

    const marginTop = effCfg.pageMargins.blockStart;
    const marginBottom = effCfg.pageMargins.blockEnd;
    let top = Math.max(marginTop, headerHeight);
    let bottom = Math.max(marginBottom, footerHeight);

    // Growth cap (#329): keep the body content area ≥ minBody so a header/footer
    // taller than the page never drives it ≤ 0 (which would crash the pipeline).
    // Clamp minBody to this boundary's usable band so a degenerate page (margins
    // alone ≥ pageBlockSize) still yields a non-negative budget; that degenerate
    // case is independently caught by the doc-wide coarse guard, not here.
    const minBody = Math.max(0, Math.min(minBodyPx, effCfg.pageBlockSize - marginTop - marginBottom));
    const maxInsetSum = effCfg.pageBlockSize - minBody;
    if (top + bottom > maxInsetSum) {
      // Cap the GROWTH-BEYOND-MARGIN proportionally — margins are the floor and
      // are never reduced. A lone tall slot gets the whole budget; a both-tall
      // page splits it in proportion to each slot's growth.
      const growthTop = top - marginTop;
      const growthBottom = bottom - marginBottom;
      const growth = growthTop + growthBottom;
      const budget = Math.max(0, maxInsetSum - marginTop - marginBottom);
      // GUARD the divide: when growth is 0 there is no growth to redistribute
      // (and 0/0 would be NaN), so leave top/bottom at the margins.
      if (growth > 0) {
        top = marginTop + (growthTop * budget) / growth;
        bottom = marginBottom + (growthBottom * budget) / growth;
      }
    }

    // Omit a boundary whose insets both reduce to the raw margins — the
    // measurePass fallback produces the identical values, so storing them is
    // redundant (and keeps the no-slot path map small). A capped boundary won't
    // equal margins (it grew past them, then shrank to a value strictly above
    // its margin while the budget remains), so it is still stored — correct.
    if (top === marginTop && bottom === marginBottom) {
      continue;
    }
    // Key by the section's id (NOT the body id) — the value `sectionStateAt`
    // returns as `activeSectionId` and `measurePass` looks up. `null` for the
    // implicit leading run.
    insets.set(boundary.sectionId, { top, bottom });
  }
  return insets;
}
