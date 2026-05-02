import type { RenderNode, ElementBox } from "../render/render-node-v2";
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
  oldLayout: LayoutBox | null,
  containerWidth: number,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  pageConfig?: PageConfig,
): LayoutBox {
  const t = markStart("layoutTreeIncremental");
  try {
    // Plan 2: whole-tree identity short-circuit.
    if (newRoot === oldRoot && oldLayout !== null && oldLayout.width === containerWidth) {
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

    // Plan 3.H: build a prevLayoutCache from the old layout so that layoutBlock
    // can reuse unchanged subtrees by reference. We need the old render root to
    // populate render-node references in the cache entries.
    const prevCache = (oldLayout !== null && oldRoot !== null)
      ? buildLayoutBoxCacheFromTree(oldLayout, oldRoot)
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

    let result: LayoutBox;
    switch (cs.display) {
      case "block": {
        const blockResult = layoutBlock(layoutRoot, 0, 0, rootCtx, shaper);
        if (blockResult.box === null) {
          throw new Error("layoutBlock at dispatch returned null box; should be unreachable in unpaginated path");
        }
        result = blockResult.box;
        break;
      }
      case "table":
        result = layoutTable(layoutRoot, 0, 0, rootCtx, shaper);
        break;
      default:
        // Fall back to full layout for unsupported display values.
        result = layoutTree(newRoot, containerWidth, shaperOrMeasurer, pageConfig);
        break;
    }

    // Pagination: when configured, wrap the BFC's output in PageBoxes.
    if (pageConfig !== undefined && result.type === "block") {
      result = paginateRoot(result, pageConfig);
    }

    return result;
  } finally {
    markEnd("layoutTreeIncremental", t);
  }
}
