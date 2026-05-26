import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * Document: the root container block. Holds child blocks (paragraphs,
 * lists, tables, etc.). The renderer pre-renders all children; this
 * component wraps them in a single block-level ElementBox.
 *
 * `whiteSpace: "pre-wrap"` is the editor's body default: a word processor
 * preserves every space the user types (leading, interior runs, trailing)
 * while still wrapping at word boundaries — Google-Docs / Word behavior.
 * `whiteSpace` is an inherited property (`property-meta.ts`), so declaring
 * it once on the document root cascades to all body text; the global CSS
 * *initial* value stays `normal`. Per-component overrides (e.g. a future
 * code block that wants `pre`) set their own `whiteSpace`.
 */
export const documentComponent: ContainerComponentDefinition = {
  type: "document",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(
      view.id,
      { display: "block", whiteSpace: "pre-wrap" },
      childRenderNodes,
    ),
};
