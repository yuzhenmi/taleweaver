import type { LeafComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";
import { imageWrapFloat } from "./leaf-style-attrs";

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
    const alt = strAttr(view.attrs.alt, "");
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
    // Component-set seam: synthesize the LOGICAL `float` from the Google-Docs
    // physical `wrap` attr against the cascaded writing `direction`. A generic
    // cascade interpreter would no-op here (computedStyle is re-derived from
    // node.style at layout; the render-time view.computedStyle isn't threaded
    // onto the box style), so the component bakes `float` on directly. The
    // `?? "ltr"` guards the test stub's bare `{} as ComputedStyle` — on a real
    // cascaded view `direction` is always present (ComputedStyle required field).
    const direction = view.computedStyle.direction ?? "ltr";
    const float = imageWrapFloat(view.attrs.wrap, direction);
    return createElementBox(
      view.id,
      // Spread `float` only when defined so a non-wrapped image's style stays
      // byte-identical to before (no `float` key) — break/missing keeps the
      // full-width `display:block` default.
      float !== undefined
        ? { display: "block", inlineSize, blockSize, float }
        : { display: "block", inlineSize, blockSize },
      [],
      { image: { src, width, height, alt } },
    );
  },
};
