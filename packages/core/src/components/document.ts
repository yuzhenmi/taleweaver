import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * Document: the root container block. Holds child blocks (paragraphs,
 * lists, tables, etc.). The renderer pre-renders all children; this
 * component wraps them in a single block-level ElementBox.
 *
 * `whiteSpace: "break-spaces"` is the editor's body default — matching Google
 * Docs' trailing-space behavior. A word processor preserves every space the
 * user types (leading, interior runs, trailing) and wraps at WORD boundaries.
 * Trailing whitespace at a soft-wrap boundary HANGS (#338): a space unit never
 * wraps to the next line on its own (only words wrap), and a hung space is
 * CLAMPED to the line's content edge — its box geometry and the caret are
 * pinned to the edge, so no number of trailing spaces pushes a glyph or the
 * caret past the page edge. So a lone trailing space stays at the line end
 * (the next word wraps), and N trailing spaces all collapse at the edge,
 * on-page. This is an intentional, Google-Docs-matching deviation from literal
 * CSS `break-spaces` (which would wrap each space to the next line) — settled
 * by the word-processor convention over the browser convention for this
 * editing-shape question. (It also supersedes the reverted `pre-wrap` "hang",
 * which lacked the clamp and let the caret run off-page.) `whiteSpace` is an
 * inherited property (`property-meta.ts`), so declaring it once on the document
 * root cascades to all body text; the global CSS *initial* value stays
 * `normal`. Per-component overrides (e.g. a future code block that wants `pre`)
 * set their own `whiteSpace`.
 */
export const documentComponent: ContainerComponentDefinition = {
  type: "document",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(
      view.id,
      { display: "block", whiteSpace: "break-spaces" },
      childRenderNodes,
      // The implicit-section default header/footer body ids (C.2c). A
      // section-less document (or the leading section-less run) takes its
      // header/footer from the doc root's own attrs; `section-plan`'s
      // `buildSectionPlan` reads these off `cascadedRoot.metadata` onto the
      // implicit/leading boundary. Stamped RAW (no AttrRegistry interpreter),
      // mirroring how the section component stamps per-section ids; the plan
      // coerces them (string ⇒ BlockId, else undefined).
      {
        headerBlockId: view.attrs.headerBlockId,
        footerBlockId: view.attrs.footerBlockId,
      },
    ),
};
