import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const listComponent: ComponentDefinition = {
  type: "list",
  // TODO Plan 2 — real list rendering (ordered/unordered with markers)
  render: (state, children) =>
    createElementBox(state.id, { display: "block" }, children),
};
