import type { LeafComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

function numAttr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function strAttr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Image: an atomic leaf. Reads `src`, `width`, `height` from attrs;
 * ignores inline content (none should exist on an image block).
 */
export const imageComponent: LeafComponentDefinition = {
  type: "image",
  kind: "leaf",
  leafShape: "atomic",
  render: (view, _ctx, _inlineRenderNodes) => {
    const src = strAttr(view.attrs.src, "");
    const width = numAttr(view.attrs.width, 0);
    const height = numAttr(view.attrs.height, 0);
    return createElementBox(
      view.id,
      { display: "block", inlineSize: width, blockSize: height },
      [],
      { image: { src, width, height } },
    );
  },
};
