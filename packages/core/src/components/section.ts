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
    // Stamp the section marker plus any page-geometry overrides from attrs into
    // the ElementBox metadata. ElementBox has no `attrs` field, so geometry must
    // ride through `metadata`; values may be `undefined` (no override) — the
    // section-page-config validator (C.2b-2) handles absence. Metadata is
    // additive and `display: contents` is unchanged, so transparency holds.
    createElementBox(view.id, { display: "contents" }, childRenderNodes, {
      blockType: "section",
      pageInlineSize: view.attrs.pageInlineSize,
      pageBlockSize: view.attrs.pageBlockSize,
      pageMargins: view.attrs.pageMargins,
      pageGap: view.attrs.pageGap,
      // Per-section header/footer body ids (C.2c). Stamped RAW (no AttrRegistry
      // interpreter) exactly as the geometry keys above; `section-plan`'s
      // `makeSectionBoundary` coerces them (string ⇒ BlockId, else undefined).
      headerBlockId: view.attrs.headerBlockId,
      footerBlockId: view.attrs.footerBlockId,
      // Per-section multi-column overrides (Format ▸ Columns). Stamped RAW like
      // the geometry keys; `section-plan`'s `makeSectionBoundary` resolves them
      // via `resolveColumnConfig`. INERT in slice 1 (no layout consumer yet).
      columnCount: view.attrs.columnCount,
      columnGap: view.attrs.columnGap,
      columnRule: view.attrs.columnRule,
    }),
};
