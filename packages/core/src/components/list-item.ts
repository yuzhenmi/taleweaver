import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const listItemComponent: ComponentDefinition = {
  type: "list-item",
  // TODO Plan 2 — real list-item rendering
  render: (state, children) =>
    createElementBox(state.id, { display: "block" }, children),
};
