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
 *
 * Sizing semantics:
 *   - When `width` / `height` attrs are MISSING entirely, the
 *     corresponding `inlineSize` / `blockSize` is `"auto"` so the image
 *     sizes intrinsically (browser-faithful default for a fresh insert).
 *   - When an attr is PRESENT, `numAttr` coerces to a number, falling
 *     back to `0` if the value is non-numeric. "Specified-but-garbage"
 *     is distinct from "missing"; the former is treated as a 0-sized
 *     authored value rather than silently switching back to intrinsic.
 */
export const imageComponent: LeafComponentDefinition = {
  type: "image",
  kind: "leaf",
  leafShape: "atomic",
  render: (view, _ctx, _inlineRenderNodes) => {
    const src = strAttr(view.attrs.src, "");
    const widthAttr = view.attrs.width;
    const heightAttr = view.attrs.height;
    const inlineSize = widthAttr !== undefined ? numAttr(widthAttr, 0) : "auto";
    const blockSize = heightAttr !== undefined ? numAttr(heightAttr, 0) : "auto";
    // Metadata carries the numeric resolution of width/height — when the
    // attrs are missing this stays `0` (the legacy default) so consumers
    // reading metadata directly behave unchanged. The sizing change above
    // is what makes a fresh-insert image size intrinsically.
    const width = numAttr(widthAttr, 0);
    const height = numAttr(heightAttr, 0);
    return createElementBox(
      view.id,
      { display: "block", inlineSize, blockSize },
      [],
      { image: { src, width, height } },
    );
  },
};
