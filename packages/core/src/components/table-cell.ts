import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const tableCellComponent: ComponentDefinition = {
  type: "table-cell",
  render: (state, children) =>
    createElementBox(state.id, {
      display: "table-cell",
      borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderLeftWidth: 1,
      borderTopStyle: "solid", borderRightStyle: "solid", borderBottomStyle: "solid", borderLeftStyle: "solid",
      borderTopColor: "#dadce0", borderRightColor: "#dadce0", borderBottomColor: "#dadce0", borderLeftColor: "#dadce0",
      paddingTop: 4, paddingRight: 8, paddingBottom: 4, paddingLeft: 8,
      ...state.style,
    }, children),
};
