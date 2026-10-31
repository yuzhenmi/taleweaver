import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { getBlock, mergeBlockAttrs } from "../../state";
import type { ActionOf, ImageWrap } from "../editor-action";

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
  { blockId, wrap }: ActionOf<"SET_IMAGE_WRAP">,
): Edit | null {
  const block = getBlock(editor.document, blockId);
  if (block === null || block.type !== "image") return null;
  if (!VALID_WRAP.has(wrap)) return null;

  // break == default == absence: clear the attr so break and never-wrapped are
  // byte-identical state. left/right store the value.
  const incoming = wrap === "break" ? { wrap: undefined } : { wrap };
  const result = mergeBlockAttrs(
    editor.document,
    blockId,
    incoming,
  );
  if (result.state === editor.document) return null;

  return { change: result };
}
