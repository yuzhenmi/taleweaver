import type { RenderNode, ElementBox } from "../render/render-node";
import type { LayoutBox } from "./layout-box-v2";
import type { TextShaper } from "./text-shaper";
import type { TextMeasurer } from "./text-measurer";
import type { PageConfig } from "./page-config";
import { isTextShaper, measurerToShaper } from "./text-measurer";
import { layoutTree } from "./dispatch";
import { layoutBlock } from "./bfc";
import { layoutTable } from "./table-fc";
import { cascadePass } from "../cascade";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { makeRootContext } from "./layout-context";
import { buildLayoutBoxCacheFromTree } from "./layout-reuse";
import { markStart, markEnd } from "../perf/perf-trace";
import { paginateRoot } from "./paginate";
import { measurePassUnsupported } from "./measure-pass";
import { buildVirtualPaginatedTree } from "./virtual-producer";
import type { VirtualLayoutTree } from "./virtual-layout-tree";

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
      // features it models; documents with float/`clear` fall back to the
      // legacy positioned `paginateRoot` path (design §"Out of scope for v1").
      if (!measurePassUnsupported(layoutRoot)) {
        // Virtual mode: build the page plan + a lazily-materializing
        // `VirtualLayoutTree`. No page is positioned here (the win lands when
        // consumers stop materializing in Tasks 2/3); in Task 1 every consumer
        // rides `resolvePositionedTree`'s `materializeAll()` bridge. The prior
        // VirtualLayoutTree (when there was one) threads through as the
        // carry-forward memo so unchanged pages reuse their PageBox by ref.
        result = buildVirtualPaginatedTree(layoutRoot, rootCtx, shaper, pageConfig, prevVirtual);
      } else {
        // Unsupported-feature fallback: legacy positioned page tree.
        // paginateRoot drives layoutBlock per page; pass rootCtx so the
        // subtree-reuse cache flows through, and the prior POSITIONED layout so
        // paginate's per-page cache (L-PERF-C) can short-circuit unchanged
        // pages without invoking layoutBlock at all.
        result = paginateRoot(layoutRoot, rootCtx, shaper, pageConfig, prevPositioned);
      }
    } else {
      switch (cs.display) {
        case "block": {
          const blockResult = layoutBlock(layoutRoot, 0, 0, rootCtx, shaper);
          if (blockResult.box === null) {
            throw new Error("layoutBlock at dispatch returned null box; should be unreachable in unpaginated path");
          }
          result = blockResult.box;
          break;
        }
        case "table": {
          const tableResult = layoutTable(layoutRoot, 0, 0, rootCtx, shaper);
          if (tableResult.box === null) {
            throw new Error("layoutTable without fragmentation returned null box; should be unreachable (no FragmentationContext passed)");
          }
          result = tableResult.box;
          break;
        }
        default:
          // Fall back to full layout for unsupported display values.
          result = layoutTree(newRoot, containerWidth, shaperOrMeasurer, pageConfig);
          break;
      }
    }

    return result;
  } finally {
    markEnd("layoutTreeIncremental", t);
  }
}
