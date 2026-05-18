import type { ComponentDefinition } from "./component-definition-legacy";
import { createElementBox } from "../render/render-node";

export const tableCellComponent: ComponentDefinition = {
  type: "table-cell",
  render: (state, children) =>
    createElementBox(state.id, {
      display: "table-cell",
      borderBlockStartWidth: 1, borderInlineEndWidth: 1, borderBlockEndWidth: 1, borderInlineStartWidth: 1,
      borderBlockStartStyle: "solid", borderInlineEndStyle: "solid", borderBlockEndStyle: "solid", borderInlineStartStyle: "solid",
      borderBlockStartColor: "#dadce0", borderInlineEndColor: "#dadce0", borderBlockEndColor: "#dadce0", borderInlineStartColor: "#dadce0",
      paddingBlockStart: 4, paddingInlineEnd: 8, paddingBlockEnd: 4, paddingInlineStart: 8,
      ...state.style,
    }, children),
};
