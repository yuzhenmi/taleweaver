/**
 * @module section-plan
 *
 * Section-structure pre-pass (P1.C.2b-1, Task 1).
 *
 * Sections compute `display: contents`, so C.1a's `flattenContents` splices them
 * OUT of the child list the measure pass iterates — the paginator can't see
 * section boundaries directly. This module walks the UNFLATTENED cascaded doc
 * root and produces a `SectionPlan`: the ordered section boundaries expressed as
 * indices into the FLATTENED child list (the same list `measurePass` /
 * `buildBlockFitMetas` see). The plan is a pure function of the cascaded tree —
 * sections self-identify via a `{ blockType: "section" }` metadata marker stamped
 * by the section component, so no predicate parameter / state threading is needed.
 *
 * This pre-pass is inert on its own; T2/T3 consume the plan to force a page break
 * before the flattened child that begins a new section.
 */
import type { RenderNode, ElementBox } from "../render/render-node";
import { coerceBlockId } from "../state";
import type { BlockId } from "../state";
import type { PageConfig } from "./page-config";
import { flattenContents } from "./group-children";
import { resolveSectionPageConfig } from "./section-page-config";

/** One section boundary: the section starts at flattened-child index `startFlattenedIndex`. */
export interface SectionBoundary {
  readonly startFlattenedIndex: number;
  /** The `section` block's id, or null for the implicit (section-less) leading section. */
  readonly sectionId: BlockId | null;
  /**
   * The section's effective page geometry, if it OVERRIDES the doc-wide config
   * (C.2b-2). `undefined` for the implicit leading boundary and for any section
   * whose attrs resolve equal to docWide — leaving the no-override path inert,
   * so consumers (T2's measure pass) fall back to docWide when this is absent.
   */
  readonly pageConfig?: PageConfig;
  /**
   * The id of the `templateContents` body that lays out into this section's
   * pages' HEADER slot (C.2c). For a real section, the section's `headerBlockId`
   * attr (stamped raw into the section box metadata, coerced here); for the
   * implicit/leading boundary, the DOC-ROOT box's `headerBlockId` metadata.
   * `undefined` when the section/doc declares no header. The measure pass tags
   * each page with the active boundary's value so a later task lays the body
   * into the slot — T2 only carries the id, no layout yet.
   */
  readonly headerBlockId?: BlockId;
  /** The footer-slot body id; symmetric to `headerBlockId` (C.2c). */
  readonly footerBlockId?: BlockId;
}

export interface SectionPlan {
  /** Ordered by startFlattenedIndex ascending; boundaries[0].startFlattenedIndex === 0 always. */
  readonly boundaries: readonly SectionBoundary[];
}

/** The active section + the next boundary at/after a flattened-child index. */
export interface SectionStateAt {
  readonly activeSectionId: BlockId | null;
  /** startFlattenedIndex of the next boundary strictly AFTER `index`, or null if none. */
  readonly nextBoundaryIndex: number | null;
  /**
   * The active boundary's page-geometry override, if any (C.2b-2). `undefined`
   * when the active boundary carries no override (the common case + the implicit
   * leading boundary); the measure pass applies the `?? docWide` fallback.
   */
  readonly pageConfig?: PageConfig;
  /**
   * The active boundary's header-slot body id (C.2c), or `undefined` when the
   * active section/doc declares no header. The measure pass stamps it onto each
   * page so a later task lays the templateContents body into the header slot.
   */
  readonly headerBlockId?: BlockId;
  /** The active boundary's footer-slot body id; symmetric (C.2c). */
  readonly footerBlockId?: BlockId;
}

/**
 * A single implicit section spanning the whole flattened child list. Passed by
 * `measurePass` callers that have no section structure (tests / equivalence
 * oracle): a single boundary at index 0 means `nextBoundaryIndex` is always null,
 * so NO breaks fire — pagination is byte-identical to the pre-section behavior.
 */
export const IMPLICIT_SECTION_PLAN: SectionPlan = {
  boundaries: [{ startFlattenedIndex: 0, sectionId: null }],
};

/**
 * Is this render node a `section`? Sections are `display: contents` ElementBoxes
 * stamped with the `{ blockType: "section" }` metadata marker by the section
 * component (the only new signal needed to identify sections in the cascaded tree).
 */
export function isSectionBox(node: RenderNode): node is ElementBox {
  return node.type === "element" && node.metadata?.blockType === "section";
}

/**
 * Deep-equal two `PageConfig`s over their scalar + margin fields. Used to keep
 * the no-override path inert: a section whose resolved config equals docWide
 * gets NO `pageConfig` stamped on its boundary. Exported so the measure pass's
 * per-entry geometry reuse gate (C.2b-2) can reuse the SAME comparison — a
 * page's fit depends on its effective geometry, so a config that differs by
 * reference but is field-equal must still count as reusable.
 */
export function pageConfigsEqual(a: PageConfig, b: PageConfig): boolean {
  return (
    a.pageInlineSize === b.pageInlineSize &&
    a.pageBlockSize === b.pageBlockSize &&
    a.pageGap === b.pageGap &&
    a.pageMargins.blockStart === b.pageMargins.blockStart &&
    a.pageMargins.blockEnd === b.pageMargins.blockEnd &&
    a.pageMargins.inlineStart === b.pageMargins.inlineStart &&
    a.pageMargins.inlineEnd === b.pageMargins.inlineEnd
  );
}

/**
 * Build a `SectionBoundary` for a real section, resolving its effective page
 * geometry from the section's metadata over `docWide`. The `pageConfig` field
 * is stamped ONLY when the resolved config differs from `docWide`; an equal
 * (or no-override) config leaves it `undefined`, keeping the common case inert.
 *
 * Header/footer body ids (C.2c) are read RAW off the section box metadata and
 * coerced (string ⇒ BlockId, else `undefined`); they are independent of the
 * geometry-override gate — a section may carry a header without overriding its
 * page geometry. An `undefined` id key is simply absent on the boundary.
 */
function makeSectionBoundary(
  startFlattenedIndex: number,
  sectionBox: ElementBox,
  docWide: PageConfig,
): SectionBoundary {
  const cfg = resolveSectionPageConfig(docWide, sectionBox.metadata);
  const sectionId = sectionBox.key as BlockId;
  const headerBlockId = coerceBlockId(sectionBox.metadata?.headerBlockId);
  const footerBlockId = coerceBlockId(sectionBox.metadata?.footerBlockId);
  return {
    startFlattenedIndex,
    sectionId,
    // Stamp `pageConfig` only when the override differs from docWide (the
    // no-override path stays inert); the spread keeps the field absent otherwise.
    ...(pageConfigsEqual(cfg, docWide) ? {} : { pageConfig: cfg }),
    ...(headerBlockId !== undefined ? { headerBlockId } : {}),
    ...(footerBlockId !== undefined ? { footerBlockId } : {}),
  };
}

/**
 * Walk `cascadedRoot.children` UNFLATTENED, building the ordered list of section
 * boundaries as indices into the FLATTENED child list.
 *
 * For each child, in document order:
 * - If it is a section, open a boundary at the running `flattenedCount`
 *   (DE-DUP: if a boundary already exists at this index — e.g. preceded by an
 *   empty section — REPLACE its sectionId, keeping the LAST section opened at the
 *   index). Then advance `flattenedCount` by the section's own flattened length.
 *   Each real boundary resolves its effective `pageConfig` from the section's
 *   geometry metadata over `docWide` (stamped only when it differs from docWide).
 * - Else advance `flattenedCount` by the child's flattened length (normally 1; a
 *   non-section `display:contents` wrapper correctly expands via `flattenContents`).
 *
 * After the walk, if no boundary sits at index 0 (the first child is not a
 * section), PREPEND the implicit `{ 0, null }` boundary (no `pageConfig`). A
 * section-less doc thus yields exactly `[{ 0, null }]`. The implicit/leading
 * boundary takes its header/footer body ids from the DOC-ROOT box's own
 * metadata (C.2c — the implicit-section default lives on the doc root), so a
 * section-less doc with a doc-root header flows it to that boundary.
 *
 * INVARIANT (I-2): the returned `boundaries` are sorted with STRICTLY increasing
 * `startFlattenedIndex` — the de-dup guarantees no two entries share an index.
 */
export function buildSectionPlan(
  cascadedRoot: ElementBox,
  docWide: PageConfig,
): SectionPlan {
  // Doc-root header/footer body ids (C.2c, I1): the implicit/leading section's
  // default, read RAW off the doc-root box metadata and coerced. The doc-root
  // box IS `cascadedRoot`. Computed before the children loop so it is available
  // when the implicit boundary is prepended below — independent of whether the
  // doc has any real sections.
  const docHeaderBlockId = coerceBlockId(cascadedRoot.metadata?.headerBlockId);
  const docFooterBlockId = coerceBlockId(cascadedRoot.metadata?.footerBlockId);

  // Mutable accumulator; the de-dup needs to overwrite the last-pushed boundary
  // when a coincident index recurs, so we build with a plain array.
  const boundaries: SectionBoundary[] = [];
  let flattenedCount = 0;

  for (const child of cascadedRoot.children) {
    if (isSectionBox(child)) {
      const startFlattenedIndex = flattenedCount;
      const boundary = makeSectionBoundary(startFlattenedIndex, child, docWide);
      const last = boundaries[boundaries.length - 1];
      if (last !== undefined && last.startFlattenedIndex === startFlattenedIndex) {
        // De-dup: a coincident boundary (preceding empty section). Keep the LAST
        // section opened at this index — its body, if any, belongs to it.
        boundaries[boundaries.length - 1] = boundary;
      } else {
        boundaries.push(boundary);
      }
      flattenedCount += flattenContents([child]).length;
    } else {
      flattenedCount += flattenContents([child]).length;
    }
  }

  // Implicit leading section: if nothing opened at index 0, the doc begins with
  // a section-less run. Its header/footer body ids come from the doc root (I1) —
  // an explicit section starting at index 0 instead owns page 0 with its OWN
  // ids, so this branch (and the doc-root default) does not apply there.
  if (boundaries.length === 0 || boundaries[0].startFlattenedIndex !== 0) {
    boundaries.unshift({
      startFlattenedIndex: 0,
      sectionId: null,
      ...(docHeaderBlockId !== undefined ? { headerBlockId: docHeaderBlockId } : {}),
      ...(docFooterBlockId !== undefined ? { footerBlockId: docFooterBlockId } : {}),
    });
  }

  return { boundaries };
}

/**
 * The active section + next boundary at a flattened-child `index`.
 *
 * Binary-searches `boundaries` (sorted, strictly increasing per I-2) for the last
 * boundary with `startFlattenedIndex <= index`: its `sectionId` is the active
 * section; the next boundary's `startFlattenedIndex`, if any, is `nextBoundaryIndex`
 * (the forced-break cap that ends this section), else null. O(log boundaries).
 */
export function sectionStateAt(plan: SectionPlan, index: number): SectionStateAt {
  const { boundaries } = plan;
  // Find the rightmost boundary with startFlattenedIndex <= index.
  let lo = 0;
  let hi = boundaries.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (boundaries[mid].startFlattenedIndex <= index) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const active = boundaries[found];
  const next = boundaries[found + 1];
  return {
    activeSectionId: active.sectionId,
    nextBoundaryIndex: next !== undefined ? next.startFlattenedIndex : null,
    // Surface the active boundary's geometry override (C.2b-2); `undefined`
    // when it carries none ⇒ the measure pass falls back to docWide.
    pageConfig: active.pageConfig,
    // Surface the active boundary's header/footer body ids (C.2c); `undefined`
    // when the active section/doc declares none. The measure pass stamps these
    // onto each page so a later task lays the body into the slot.
    headerBlockId: active.headerBlockId,
    footerBlockId: active.footerBlockId,
  };
}
