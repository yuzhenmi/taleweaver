import type { LeafComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * The Table of Contents anchor block. An atomic-leaf (no editable
 * inlineContent): it carries the TOC options as attrs; its on-page entry
 * subtree is synthesized by the render-core TOC branch (a later slice). This
 * render is the placeholder / state-shape definition — a zero-height block
 * tagged with `tableOfContents` metadata so the later render branch can
 * recognize the anchor.
 */
export const tableOfContentsComponent: LeafComponentDefinition = {
  type: "table-of-contents",
  kind: "leaf",
  leafShape: "atomic",
  render: (view, _ctx, _inlineRenderNodes) =>
    createElementBox(
      view.id,
      { display: "block", blockSize: 0 },
      [],
      { tableOfContents: true },
    ),
};
