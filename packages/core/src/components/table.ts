import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

function isNumberArray(v: unknown): v is readonly number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}

export const tableComponent: ContainerComponentDefinition = {
  type: "table",
  kind: "container",
  render: (view, _ctx, childRenderNodes) => {
    const cw = view.attrs.columnWidths;
    const metadata = isNumberArray(cw) ? { columnWidths: cw } : undefined;
    return createElementBox(
      view.id,
      { display: "table" },
      childRenderNodes,
      metadata,
    );
  },
};
