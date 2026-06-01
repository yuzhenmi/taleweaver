import type { LeafComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const horizontalLineComponent: LeafComponentDefinition = {
  type: "horizontal-line",
  kind: "leaf",
  leafShape: "atomic",
  render: (view, _ctx, _inlineRenderNodes) =>
    createElementBox(
      view.id,
      { display: "block", blockSize: 16 },
      [],
      { horizontalLine: true },
    ),
};
