import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * Document: the root container block. Holds child blocks (paragraphs,
 * lists, tables, etc.). The renderer pre-renders all children; this
 * component wraps them in a single block-level ElementBox.
 *
 * `whiteSpace: "break-spaces"` is the editor's body default — matching Google
 * Docs' trailing-space behavior. A word processor preserves every space the
 * user types (leading, interior runs, trailing) and wraps at word boundaries;
 * `break-spaces` additionally makes preserved spaces TAKE WIDTH and WRAP
 * independently to the next line (CSS Text 3: a soft-wrap opportunity after
 * every preserved space, incl. at line end). That keeps the caret on-page
 * after trailing spaces — unlike `pre-wrap`, which would hang trailing spaces
 * past the page edge. `whiteSpace` is an inherited property
 * (`property-meta.ts`), so declaring it once on the document root cascades to
 * all body text; the global CSS *initial* value stays `normal`. Per-component
 * overrides (e.g. a future code block that wants `pre`) set their own
 * `whiteSpace`.
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
