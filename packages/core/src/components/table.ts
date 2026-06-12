import type { ContainerComponentDefinition } from "./component-definition";
import type { LayoutBoxMetadata } from "../render/layout-metadata";
import { createElementBox } from "../render/render-node";

function isNumberArray(v: unknown): v is readonly number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export const tableComponent: ContainerComponentDefinition = {
  type: "table",
  kind: "container",
  render: (view, _ctx, childRenderNodes) => {
    const cw = view.attrs.columnWidths;
    const hrc = view.attrs.headerRowCount;
    const metadata: LayoutBoxMetadata = {
      ...(isNumberArray(cw) ? { columnWidths: cw } : {}),
      ...(isNonNegativeInteger(hrc) ? { headerRowCount: hrc } : {}),
    };
    // Stay `undefined` (the prior contract) when NEITHER field is present, so a
    // plain table carries no metadata bag.
    const hasMetadata = metadata.columnWidths !== undefined || metadata.headerRowCount !== undefined;
    return createElementBox(
      view.id,
      { display: "table" },
      childRenderNodes,
      hasMetadata ? metadata : undefined,
    );
  },
};
