import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, mergeBlockAttrs } from "../../state";
import type { BlockId } from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * `SET_IMAGE_ALT` handler — sets the accessible name (`alt`) on an `image` block;
 * the a11y projection (`build-accessibility-tree.ts` `imageAlt`) reads it. Like
 * `SET_IMAGE_WRAP`/`SET_IMAGE_SIZE`, the target is an explicit `blockId` (an image
 * is an atomic leaf, never a Selection focus).
 *
 * THREE-STATE semantics (HTML/ARIA convention — alt is meaningful in all three),
 * UNLIKE `SET_IMAGE_WRAP` where the default is stored as ABSENCE:
 *   - absent          → unlabeled image (AT announces "image"/filename).
 *   - `""` (empty)    → explicitly DECORATIVE (AT skips it).
 *   - non-empty       → labeled.
 * Because `""` is a meaningful, distinct DECORATIVE marker — NOT the default — it is
 * PRESERVED as a set value and is NOT collapsed to absence. So a string (INCLUDING
 * the empty string) is stored via `mergeBlockAttrs({ alt })`, and only `null`
 * clears the attr (`{ alt: undefined }` → the key is removed → back to absent).
 *
 * No-op (returns `editor` unchanged, no `history.commit`) when: the block is missing
 * or not an `image`; or the merge is identity (already that alt — incl. `null` on an
 * already-unlabeled image). Selection is UNCHANGED. One undo entry.
 */
export function handleSetImageAlt(
  editor: EditorState,
  blockId: BlockId,
  alt: string | null,
  config: EditorConfig,
): EditorState {
  const block = getBlock(editor.state, blockId);
  if (block === null || block.type !== "image") return editor;

  // A string (incl. "") SETS alt; null CLEARS it. The empty string is a distinct
  // DECORATIVE marker, so it is stored as a present key — never collapsed to
  // absence the way SET_IMAGE_WRAP collapses its "break" default.
  const incoming = alt === null ? { alt: undefined } : { alt };
  const result = mergeBlockAttrs(
    editor.state,
    blockId,
    incoming,
    config.attrRegistry,
  );
  if (result.state === editor.state) return editor;

  editor.history.commit(result, {
    before: editor.selection,
    after: editor.selection,
  });
  return rebuildTrees(
    { ...editor, state: result.state },
    editor,
    config,
    result.dirtyIds,
  );
}
