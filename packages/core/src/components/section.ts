import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * A `section` is a pagination-level grouping of body blocks. It is LAYOUT-
 * TRANSPARENT: it computes `display: contents` (CSS Display 3 §3.2), so its
 * children lay out as if they were direct children of the section's parent
 * (the document root). C.1a's `flattenContents` handles the transparency
 * across the whole layout pipeline (`groupChildren`, `build-fit-metas`,
 * `virtual-producer`, `paginate`, `intrinsic-sizes-pass`, `ifc`); the
 * paginator's per-section page-break + page geometry is layered on top in
 * C.2 (keyed on `type === "section"`). In C.1b a section is inert: a
 * section-less document is unaffected, and an explicit section reflows its
 * body exactly as if its children were direct doc-root children.
 */
export const sectionComponent: ContainerComponentDefinition = {
  type: "section",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(view.id, { display: "contents" }, childRenderNodes, {
      blockType: "section",
    }),
};
