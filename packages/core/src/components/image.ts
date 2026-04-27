import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const imageComponent: ComponentDefinition = {
  type: "image",
  // TODO Plan 2 — real image rendering
  render: (state, children) =>
    createElementBox(state.id, { display: "block" }, children),
};
