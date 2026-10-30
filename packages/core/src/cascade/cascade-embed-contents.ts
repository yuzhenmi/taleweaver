import type { BlockId } from "../state";
import type { ElementBox } from "../render/render-node";
import type { RenderOutput } from "../render/render";
import { cascadeBodies } from "./cascade-bodies";

/**
 * Cascade every footnote body in `rendered.embedContents`, the exact parallel
 * of `cascadeTemplateContents` (which cascades header/footer bodies). Same
 * full + incremental semantics; see `cascadeBodies` for the shared logic. The result is
 * stored on `EditorState.cascadedEmbedContents`; the footnote layout
 * pass (`resolveFootnotes`) consumes it.
 */
export function cascadeEmbedContents(
  rendered: RenderOutput,
  prevRenderOutput: RenderOutput | null,
  prevCascaded: ReadonlyMap<BlockId, ElementBox> | null,
  dirtyIds?: ReadonlySet<BlockId>,
): ReadonlyMap<BlockId, ElementBox> {
  return cascadeBodies(
    "cascadeEmbedContents",
    rendered.embedContents,
    prevRenderOutput?.embedContents ?? null,
    prevCascaded,
    dirtyIds,
  );
}
