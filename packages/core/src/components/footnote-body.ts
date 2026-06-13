import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";
import type { Style } from "../styles";

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
 *
 * `markerText` (FN-6.2b): the body displays its footnote number as a generated,
 * offset-excluded leading marker — the "1" at the start of the footnote in the
 * slot (Google Docs parity). The number comes from `ctx.footnoteNumber(view.id)`
 * (`view.id` is the body root id === the footnote's `contentBlockId`, the key
 * into the per-render numbering map), so it always matches the call marker's
 * displayed number. The BFC reads this `markerText` and emits a `MarkerBox`
 * BEFORE the body's content — offset-excluded, so it does NOT shift the body's
 * cursor offsets. A body that is not in the numbering map (shouldn't happen for a
 * real footnote) gets no marker (`markerText` omitted). Superscript styling of
 * the body number is a later visual refinement.
 */
export const footnoteBodyComponent: ContainerComponentDefinition = {
  type: "footnote-body",
  kind: "container",
  render: (view, ctx, childRenderNodes) => {
    const number = ctx.footnoteNumber(view.id);
    const style: Style = {
      display: "block",
      whiteSpace: "break-spaces",
      // Google-Docs body default — break a long unbreakable string to fit (see
      // document.ts + the overflow-wrap design spec).
      overflowWrap: "break-word",
      orphans: 1,
      widows: 1,
    };
    return createElementBox(
      view.id,
      number !== undefined ? { ...style, markerText: number } : style,
      childRenderNodes,
    );
  },
};
