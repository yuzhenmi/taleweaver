import type { EditorState, EditorConfig } from "../editor-state";
import { layoutTree } from "../../layout/dispatch";
import { EMPTY_FOOTNOTE_ANCHORS } from "../../footnotes";
import { makeBlockParentLookup } from "../block-parent-lookup";

export function handleSetContainerWidth(
  editor: EditorState,
  width: number,
  config: EditorConfig,
): EditorState {
  if (width === editor.containerWidth) return editor;
  // Task 2.5: build the layout parent-lookup so a `cross-ref-page` field to a NESTED
  // target (e.g. a table-cell paragraph the page plan doesn't index directly) still
  // resolves to its top-level ancestor's page after a resize re-layout.
  const parentOf = makeBlockParentLookup(editor.state);
  const layout = layoutTree(
    // Pass the already-cascaded root so the resize re-uses the cascaded tree
    // (and so a tall header re-paginates with the GROWN insets — see below).
    editor.cascadedRoot,
    width,
    config.measurer,
    config.pageConfig,
    // #328 (C1): thread the cascaded header/footer bodies through the FULL-build
    // resize path too. Without this, a window resize would re-paginate a
    // tall-header doc as if the header fit the margin (body jumps up, overflow
    // re-clipped). `editor.cascadedTemplateContents` is the same map the
    // incremental path threads via `rebuildTrees`.
    editor.cascadedTemplateContents,
    // The intervening optionals MUST be passed explicitly so `parentOf` binds to its
    // own slot (not slot 6). `cascadedEmbedContents` is the cascaded footnote bodies;
    // `EMPTY_FOOTNOTE_ANCHORS` is the dispatch default (EditorState doesn't store the
    // ordered anchor list — the resize path's prior behavior is anchor-free).
    editor.cascadedEmbedContents,
    EMPTY_FOOTNOTE_ANCHORS,
    parentOf,
  );
  return { ...editor, containerWidth: width, layoutTree: layout };
}
