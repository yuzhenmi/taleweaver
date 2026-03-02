import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/render-node";

export const imageComponent: ComponentDefinition = {
  type: "image",
  render: (node) => {
    const src = node.properties.src as string | undefined;
    const alt = node.properties.alt as string | undefined;
    const width = typeof node.properties.width === "number" ? node.properties.width : undefined;
    const height = typeof node.properties.height === "number" ? node.properties.height : 100;

    return createBlockNode(
      node.id,
      { paddingTop: height, marginTop: 8, marginBottom: 8 },
      [],
      undefined,
      { type: "image", src, alt, width, height },
    );
  },
};
