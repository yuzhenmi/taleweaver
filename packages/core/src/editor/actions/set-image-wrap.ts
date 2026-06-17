import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, mergeBlockAttrs } from "../../state";
import type { BlockId } from "../../state";
import { rebuildTrees } from "./helpers";

export type ImageWrap = "left" | "right" | "break";
const VALID_WRAP: ReadonlySet<string> = new Set<ImageWrap>([
  "left",
  "right",
  "break",
]);

/**
 * `SET_IMAGE_WRAP` handler — sets the Google-Docs text-wrap mode on an `image`
 * block (`"left" | "right" | "break"`); `imageComponent` reads it (`imageWrapFloat`).
 * Like `SET_IMAGE_SIZE`, the target is an explicit `blockId` (an image is an
 * atomic leaf, never a Selection focus).
 *
 * `"break"` is the DEFAULT (full-width block), so it is stored as ABSENCE:
 * `wrap:"break"` CLEARS the attr (`{ wrap: undefined }` → `mergeAttrs` removes the
 * key), making break == never-wrapped byte-identical (same convention as
 * `INDENT`/`OUTDENT` clearing `marginInlineStart` at 0). `imageWrapFloat` maps both
 * absent and `"break"` → `undefined`, so layout is identical either way; storing
 * absence keeps the STATE canonical.
 *
 * No-op (returns `editor` unchanged, no `history.commit`) when: the block is missing
 * or not an `image`; the wrap value is not one of the three valid modes; or the merge
 * is identity (already that wrap — incl. `break` on an already-un-wrapped image).
 * Selection is UNCHANGED. One undo entry.
 */
export function handleSetImageWrap(
  editor: EditorState,
  blockId: BlockId,
  wrap: ImageWrap,
  config: EditorConfig,
): EditorState {
  const block = getBlock(editor.state, blockId);
  if (block === null || block.type !== "image") return editor;
  if (!VALID_WRAP.has(wrap)) return editor;

  // break == default == absence: clear the attr so break and never-wrapped are
  // byte-identical state. left/right store the value.
  const incoming = wrap === "break" ? { wrap: undefined } : { wrap };
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
