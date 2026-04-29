import type { RenderNode, ElementBox } from "../render/render-node-v2";
import type { LayoutBox } from "./layout-box-v2";
import type { TextShaper } from "./text-shaper";
import type { TextMeasurer } from "./text-measurer";
import { isTextShaper, measurerToShaper } from "./text-measurer";
import { layoutBlock } from "./bfc";
import { layoutTable } from "./table-fc";
import { cascadePass } from "../cascade";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { makeRootContext } from "./layout-context";
import { markStart, markEnd } from "../perf/perf-trace";

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

    switch (cs.display) {
      case "block":
        return layoutBlock(layoutRoot, 0, 0, ctx, shaper);
      case "table":
        return layoutTable(layoutRoot, 0, 0, ctx, shaper);
      default:
        throw new Error(`display "${cs.display}" not yet implemented in Plan 1`);
    }
  } finally {
    markEnd("layoutTree", t);
  }
}
