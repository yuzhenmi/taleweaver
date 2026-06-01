import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * Table cell: hardcoded 1px solid border + 4/8px padding match legacy
 * behavior. Per-cell border overrides via attrs are P12+ work (table
 * styles cleanup).
 */
export const tableCellComponent: ContainerComponentDefinition = {
  type: "table-cell",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(view.id, {
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
    }, childRenderNodes),
};
