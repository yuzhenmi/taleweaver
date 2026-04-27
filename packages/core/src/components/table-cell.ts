import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

// Plan 1 stub — Plan 2 will implement properly.
export const tableCellComponent: ComponentDefinition = {
  type: "table-cell",
  render: (state, children) =>
    createElementBox(state.id, { display: "block", ...state.style }, children),
};
