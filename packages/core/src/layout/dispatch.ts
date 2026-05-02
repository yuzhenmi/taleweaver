import type { RenderNode, ElementBox } from "../render/render-node-v2";
import type { LayoutBox } from "./layout-box-v2";
import type { TextShaper } from "./text-shaper";
import type { TextMeasurer } from "./text-measurer";
import type { PageConfig } from "./page-config";
import { isTextShaper, measurerToShaper } from "./text-measurer";
import { layoutBlock } from "./bfc";
import { layoutTable } from "./table-fc";
import { cascadePass } from "../cascade";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { makeRootContext } from "./layout-context";
import { markStart, markEnd } from "../perf/perf-trace";
import { paginateRoot } from "./paginate";

/**
 * Top-level layout entry. Dispatches by display value of the root node.
 * For Plan 1, only `display: block` is supported at the root.
 * If the render tree has not had cascade applied, runs it automatically.
 *
 * Accepts either a `TextShaper` (preferred) or a legacy `TextMeasurer`
 * (backward-compat: adapted to a shaper internally).
 */
export function layoutTree(
  root: RenderNode,
  containerInlineSize: number,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  pageConfig?: PageConfig,
): LayoutBox {
  const t = markStart("layoutTree");
  try {
    if (root.type !== "element") {
      throw new Error("Layout root must be an element node");
    }

    const shaper: TextShaper = isTextShaper(shaperOrMeasurer)
      ? shaperOrMeasurer
      : measurerToShaper(shaperOrMeasurer);

    // Auto-run cascade if computedStyle is not populated
    const layoutRoot: ElementBox = root.computedStyle
      ? root
      : (cascadePass(root) as ElementBox);

    const cs = layoutRoot.computedStyle ?? INITIAL_COMPUTED_STYLE;
    const ctx = makeRootContext(cs, containerInlineSize);

    let result: LayoutBox;

    if (pageConfig !== undefined) {
      // Paginated mode: paginateRoot drives layoutBlock per page and assembles
      // the PageBox sequence. Only display:block roots are supported in P1.B.
      // display:table roots with pageConfig are not yet handled — fall through
      // to unpaginated table layout (acceptable for P1.B scope; table-as-root
      // with pagination is unusual in real documents).
      if (cs.display === "block") {
        result = paginateRoot(layoutRoot, ctx, shaper, pageConfig);
      } else {
        // Non-block root with pagination: layout without pagination for now.
        if (cs.display === "table") {
          const tableResult = layoutTable(layoutRoot, 0, 0, ctx, shaper);
          if (tableResult.box === null) {
            throw new Error("layoutTable at dispatch returned null box; should be unreachable in unpaginated path");
          }
          result = tableResult.box;
        } else {
          throw new Error(`display "${cs.display}" not yet implemented in Plan 1`);
        }
      }
    } else {
      switch (cs.display) {
        case "block": {
          const blockResult = layoutBlock(layoutRoot, 0, 0, ctx, shaper);
          if (blockResult.box === null) {
            throw new Error("layoutBlock at dispatch returned null box; should be unreachable in unpaginated path");
          }
          result = blockResult.box;
          break;
        }
        case "table": {
          const tableResult = layoutTable(layoutRoot, 0, 0, ctx, shaper);
          if (tableResult.box === null) {
            throw new Error("layoutTable at dispatch returned null box; should be unreachable in unpaginated path");
          }
          result = tableResult.box;
          break;
        }
        default:
          throw new Error(`display "${cs.display}" not yet implemented in Plan 1`);
      }
    }

    return result;
  } finally {
    markEnd("layoutTree", t);
  }
}
