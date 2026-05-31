import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * Footnote body: the root container block for a footnote's content (the
 * subtree referenced by a `footnote-anchor` EmbedItem's
 * `properties.contentBlockId` and stored in the embedContents tree). It holds
 * paragraph children exactly as the document root holds the body's blocks — a
 * footnote is multi-paragraph (Google Docs): pressing Enter splits a child
 * paragraph into two sibling paragraphs under THIS container, and the footnote
 * slot (the `resolveFootnotes` pass) lays the whole container subtree out via
 * its BFC, rendering every line.
 *
 * Why a container, not a `paragraph` root — same rationale as
 * `template-body` (headers/footers): a `paragraph` root is a single
 * inline-bearing leaf with no children, so splitting it (Enter) would create a
 * SECOND `parentId: null` root in embedContents — a sibling the slot never
 * renders, and a spurious extra `getEmbedContentIds` entry (the #313 root-only
 * contract expects exactly one root per body). The container model keeps one
 * root; new lines are CHILDREN.
 *
 * `whiteSpace: "break-spaces"` matches the document root and template body: an
 * inherited property declared once on the body root so footnote text wraps at
 * word boundaries and preserves every typed space, exactly like the document
 * body.
 *
 * `orphans: 1, widows: 1` (FN-5, decision E2): footnotes split at single-line
 * granularity. Google Docs places a single line of a footnote body on page N and
 * the rest on N+1 — footnotes are NOT subject to the default 2-line orphan/widow
 * constraint. Without this, a 2-line body where only 1 line fits would return
 * `{ box: null }` (the whole body carries — wrong for footnotes). Both properties
 * are `inherits: true`, so they cascade from this body root through the anonymous
 * block to the IFC's `parentCs.orphans`/`parentCs.widows` readers.
 */
export const footnoteBodyComponent: ContainerComponentDefinition = {
  type: "footnote-body",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(
      view.id,
      { display: "block", whiteSpace: "break-spaces", orphans: 1, widows: 1 },
      childRenderNodes,
    ),
};
