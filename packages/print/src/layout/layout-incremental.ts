import type { RenderNode, ElementBox } from "@taleweaver/core";
import type { LayoutBox } from "./layout-box";
import type { TextShaper } from "@taleweaver/core";
import type { Hyphenator } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";
import type { PageConfig } from "./page-config";
import { isTextShaper, measurerToShaper } from "@taleweaver/core";
import { layoutTree } from "./dispatch";
import { layoutBlock } from "./bfc";
import { layoutTable } from "./table-fc";
import { cascadePass } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { makeRootContext } from "./layout-context";
import { buildLayoutBoxCacheFromTree } from "./layout-reuse";
import { markStart, markEnd } from "@taleweaver/core";
import { paginateRoot } from "./paginate";
import { paginationFallsBackToLegacy } from "./measure-pass";
import { buildVirtualPaginatedTree } from "./virtual-producer";
import type { VirtualLayoutTree } from "./virtual-layout-tree";
import type { BlockId } from "@taleweaver/core";
import { EMPTY_FOOTNOTE_ANCHORS, type FootnoteAnchorRef } from "@taleweaver/core";
import type { BlockParentLookup } from "./page-of-field-target";

/** Empty cascaded-template-body map default (no header/footer bodies). */
const EMPTY_TEMPLATE_CONTENTS: ReadonlyMap<BlockId, ElementBox> = new Map();
/** Empty cascaded-footnote-body map default (no footnote bodies). */
const EMPTY_EMBED_CONTENTS: ReadonlyMap<BlockId, ElementBox> = new Map();

/**
 * Incremental layout entry point.
 *
 * Plan 2: short-circuit when the entire tree is reference-equal AND the
 * container width is unchanged. Otherwise, fall through to Plan 3.H subtree
 * reuse below.
 *
 * Plan 3.H (Tasks 3+4): for changed trees, build a LayoutBoxCache from the
 * previous layout result and pass it into the root context. `layoutBlock`
 * consults the cache per-block and reuses any unchanged subtree boxes by
 * reference, avoiding redundant layout work.
 */
export function layoutTreeIncremental(
  newRoot: RenderNode,
  oldRoot: RenderNode | null,
  oldLayout: LayoutBox | VirtualLayoutTree | null,
  containerWidth: number,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  pageConfig?: PageConfig,
  // C.2c: cascaded header/footer template bodies (from `rebuildTrees`),
  // threaded to the virtual producer → `makeVirtualLayoutTree` closure so
  // `materializePage` can lay them into each page's header/footer slot (T4
  // consumes it). Optional, defaulting to an empty map: the many non-editor
  // callers (tests, the resize path) pass no bodies and stay byte-identical.
  cascadedTemplateContents: ReadonlyMap<BlockId, ElementBox> = EMPTY_TEMPLATE_CONTENTS,
  // FN-4.0: cascaded footnote bodies + ordered footnote anchors (from
  // `rebuildTrees`), threaded end-to-end for the footnote layout pass (FN-4.2
  // `resolveFootnotes`). UNUSED for layout output in this plumbing task.
  // Defaults keep the many non-editor callers byte-identical.
  cascadedEmbedContents: ReadonlyMap<BlockId, ElementBox> = EMPTY_EMBED_CONTENTS,
  footnoteAnchors: readonly FootnoteAnchorRef[] = EMPTY_FOOTNOTE_ANCHORS,
  parentOf?: BlockParentLookup,
  // Auto-hyphenation (slice 2): injected `Hyphenator`, threaded ALONGSIDE the
  // shaper to every layout site. Optional trailing so non-editor callers stay
  // valid; the editor incremental-rebuild path (`rebuildTrees`) passes
  // `config.hyphenator`. `undefined` ⇒ no hyphenation. Carried but UNUSED in this
  // slice (the producer is slice 4).
  hyphenator?: Hyphenator,
): LayoutBox | VirtualLayoutTree {
  const t = markStart("layoutTreeIncremental");
  try {
    // Plan 2: whole-tree identity short-circuit. Only a POSITIONED prior tree
    // exposes `.width`; a `VirtualLayoutTree` carries the plan and must be
    // re-derived (cheaply) below so its carry-forward memo + plan stay current.
    if (
      newRoot === oldRoot &&
      oldLayout !== null &&
      oldLayout.type !== "virtual-root" &&
      oldLayout.width === containerWidth
    ) {
      return oldLayout;
    }

    const shaper: TextShaper = isTextShaper(shaperOrMeasurer)
      ? shaperOrMeasurer
      : measurerToShaper(shaperOrMeasurer);

    // Auto-run cascade if not yet done.
    const layoutRoot: ElementBox = newRoot.type === "element" && newRoot.computedStyle
      ? newRoot
      : (cascadePass(newRoot) as ElementBox);

    const cs = layoutRoot.computedStyle ?? INITIAL_COMPUTED_STYLE;

    // The prior layout split by shape: a positioned `LayoutBox` (legacy /
    // unpaginated / unsupported-feature fallback) vs a `VirtualLayoutTree`
    // (paginated virtual mode). The legacy `paginateRoot` per-page WeakMap
    // cache (L-PERF-C) and the subtree-reuse cache key on positioned boxes, so
    // they apply ONLY to a positioned prior tree; the virtual tree reuses pages
    // via its own carry-forward memo (threaded as `prevTree` below).
    const prevPositioned: LayoutBox | null =
      oldLayout !== null && oldLayout.type !== "virtual-root" ? oldLayout : null;
    const prevVirtual: VirtualLayoutTree | undefined =
      oldLayout !== null && oldLayout.type === "virtual-root" ? oldLayout : undefined;

    // Plan 3.H: build a prevLayoutCache from the old layout so that layoutBlock
    // can reuse unchanged subtrees by reference. We need the old render root to
    // populate render-node references in the cache entries.
    const prevCache = (prevPositioned !== null && oldRoot !== null)
      ? buildLayoutBoxCacheFromTree(prevPositioned, oldRoot)
      : null;

    // Build the root context and inject the prev cache + prev float env.
    // The prev float env is retrieved from the root of the previous layout;
    // since we don't store it separately, we use null here — the dirtyBlockOffset
    // will fall back to +Infinity (no dirty floats assumed), which is conservative.
    const rootCtx = {
      ...makeRootContext(cs, containerWidth),
      prevLayoutCache: prevCache,
      prevFloatEnv: null,
    };

    let result: LayoutBox | VirtualLayoutTree;

    if (pageConfig !== undefined && cs.display === "block") {
      // Paginated mode. The measure pass / fit-core reproduce only the
      // features it models; `position:absolute` docs — and float docs that are
      // ALSO multi-column or footnote-bearing — fall back to the legacy
      // positioned `paginateRoot` path (single-column float/`clear` docs now take
      // the virtualized fast path; see `paginationFallsBackToLegacy`).
      if (!paginationFallsBackToLegacy(layoutRoot, footnoteAnchors)) {
        // Virtual mode: build the page plan + a lazily-materializing
        // `VirtualLayoutTree`. No page is positioned here; consumers position
        // only the pages they need via `getPage(i)` — the whole document is
        // never materialized. The prior VirtualLayoutTree (when there was one)
        // threads through as the carry-forward memo so unchanged pages reuse
        // their PageBox by ref.
        result = buildVirtualPaginatedTree(layoutRoot, rootCtx, shaper, pageConfig, prevVirtual, cascadedTemplateContents, cascadedEmbedContents, footnoteAnchors, parentOf, hyphenator);
      } else {
        // Unsupported-feature fallback: legacy positioned page tree.
        // paginateRoot drives layoutBlock per page; pass rootCtx so the
        // subtree-reuse cache flows through, and the prior POSITIONED layout so
        // paginate's per-page cache (L-PERF-C) can short-circuit unchanged
        // pages without invoking layoutBlock at all.
        result = paginateRoot(layoutRoot, rootCtx, shaper, hyphenator, pageConfig, prevPositioned);
      }
    } else {
      switch (cs.display) {
        case "block": {
          const blockResult = layoutBlock(layoutRoot, 0, 0, rootCtx, shaper, hyphenator);
          if (blockResult.box === null) {
            throw new Error("layoutBlock at dispatch returned null box; should be unreachable in unpaginated path");
          }
          result = blockResult.box;
          break;
        }
        case "table": {
          const tableResult = layoutTable(layoutRoot, 0, 0, rootCtx, shaper, hyphenator);
          if (tableResult.box === null) {
            throw new Error("layoutTable without fragmentation returned null box; should be unreachable (no FragmentationContext passed)");
          }
          result = tableResult.box;
          break;
        }
        default:
          // Fall back to full layout for unsupported display values.
          // Auto-hyphenation (slice 2): this internal fallback intentionally passes
          // NOTHING for `hyphenator` (it gets `undefined`). This is an unsupported-
          // display escape hatch with no real document content to hyphenate; the
          // editor-driven paths (block/table/paginated) above thread it correctly.
          result = layoutTree(newRoot, containerWidth, shaperOrMeasurer, pageConfig);
          break;
      }
    }

    return result;
  } finally {
    markEnd("layoutTreeIncremental", t);
  }
}
