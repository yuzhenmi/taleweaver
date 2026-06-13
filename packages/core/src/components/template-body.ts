import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * Template body: the root container block for a header / footer body
 * (the subtree linked off a section's `headerBlockId` / `footerBlockId`
 * and stored in the templateContents tree). It holds paragraph children
 * exactly as the document root holds the body's blocks — a header/footer
 * is multi-line (Google Docs): pressing Enter splits a child paragraph
 * into two sibling paragraphs under THIS container, and the page slot
 * (`materializePage`) lays the whole container subtree out via its BFC,
 * rendering every line.
 *
 * Why a container, not a `paragraph` root: a `paragraph` root is a single
 * inline-bearing leaf with no children, so splitting it (Enter) would
 * create a SECOND `parentId: null` root in templateContents — a sibling
 * the slot (which lays out only the ONE linked root's subtree) never
 * renders, and a spurious extra `getTemplateContentIds` entry (the #313
 * root-only contract expects exactly one root per body). The container
 * model keeps one root; new lines are CHILDREN.
 *
 * `whiteSpace: "break-spaces"` matches the document root (see `document.ts`
 * for the rationale): an inherited property declared once on the body root
 * so header text wraps at word boundaries and preserves every typed space,
 * exactly like the document body.
 */
export const templateBodyComponent: ContainerComponentDefinition = {
  type: "template-body",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(
      view.id,
      // `overflowWrap: "break-word"` — Google-Docs body default (break a long
      // unbreakable string to fit; mirrors document.ts + the overflow-wrap spec).
      { display: "block", whiteSpace: "break-spaces", overflowWrap: "break-word" },
      childRenderNodes,
    ),
};
