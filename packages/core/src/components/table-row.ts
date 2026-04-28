import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const tableRowComponent: ComponentDefinition = {
  type: "table-row",
  render: (state, children) =>
    createElementBox(state.id, { display: "table-row", ...state.style }, children),
};
