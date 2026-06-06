import type { ContainerComponentDefinition } from "./component-definition";
import type { LayoutBoxMetadata } from "../render/layout-metadata";
import { createElementBox } from "../render/render-node";

/**
 * A real (non-identity) span: a finite integer > 1, else undefined. A span of 1
 * is the HTML default — stamping it would be a no-op that still breaks the
 * byte-identical-for-1×1 invariant (the box would carry metadata where before it
 * didn't), so identity/absent/invalid spans return undefined and are not stamped.
 */
function spanAttr(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 1 ? Math.floor(v) : undefined;
}

/**
 * Table cell: hardcoded 1px solid border + 4/8px padding match legacy
 * behavior. Per-cell border overrides via attrs are P12+ work (table
 * styles cleanup).
 *
 * `rowSpan`/`colSpan` (P8) are STRUCTURAL grid facts — stamped RAW from the
 * cell's open-schema `attrs` into `metadata` (mirroring the `table` component's
 * `columnWidths` stamp), NOT routed through the cascade. The Table FC + intrinsic
 * pass read them via `cellSpan` (layout/table-grid.ts). Only stamped when a REAL
 * span (integer > 1) is present, so 1×1 cells — including an explicit
 * `rowSpan: 1`/`colSpan: 1` — carry no metadata (byte-identical to pre-P8).
 */
export const tableCellComponent: ContainerComponentDefinition = {
  type: "table-cell",
  kind: "container",
  render: (view, _ctx, childRenderNodes) => {
    const rowSpan = spanAttr(view.attrs.rowSpan);
    const colSpan = spanAttr(view.attrs.colSpan);
    const metadata: LayoutBoxMetadata | undefined =
      rowSpan !== undefined || colSpan !== undefined
        ? {
            ...(rowSpan !== undefined ? { rowSpan } : {}),
            ...(colSpan !== undefined ? { colSpan } : {}),
          }
        : undefined;
    return createElementBox(view.id, {
      display: "table-cell",
      borderBlockStartWidth: 1,
      borderBlockEndWidth: 1,
      borderInlineStartWidth: 1,
      borderInlineEndWidth: 1,
      borderBlockStartStyle: "solid",
      borderBlockEndStyle: "solid",
      borderInlineStartStyle: "solid",
      borderInlineEndStyle: "solid",
      borderBlockStartColor: "#dadce0",
      borderBlockEndColor: "#dadce0",
      borderInlineStartColor: "#dadce0",
      borderInlineEndColor: "#dadce0",
      paddingBlockStart: 4,
      paddingBlockEnd: 4,
      paddingInlineStart: 8,
      paddingInlineEnd: 8,
    }, childRenderNodes, metadata);
  },
};
