import type { BlockId } from "../state";
import { cascadePass, cascadePassIncremental } from "./cascade-pass";
import type { ElementBox, RenderNode } from "../render/render-node";

/**
 * Shared body-cascade engine behind `cascadeTemplateContents` (headers/footers)
 * and `cascadeEmbedContents` (footnotes). Both side-tree body maps
 * (`templateContents`, `embedContents`) are keyed by a body root BlockId and
 * carry the same full/incremental reuse contract; the only difference is which
 * `RenderOutput` map they read. `bodies` is the current render output's body
 * map; `prevBodies` is the prior render output's matching map (or null for the
 * full path); `prevCascaded` is the prior cascaded result. `opName` names the
 * caller for the non-element guard error.
 */
export function cascadeBodies(
  opName: string,
  bodies: ReadonlyMap<BlockId, RenderNode>,
  prevBodies: ReadonlyMap<BlockId, RenderNode> | null,
  prevCascaded: ReadonlyMap<BlockId, ElementBox> | null,
  dirtyIds?: ReadonlySet<BlockId>,
): ReadonlyMap<BlockId, ElementBox> {
  const out = new Map<BlockId, ElementBox>();
  for (const [id, body] of bodies) {
    const prevBody = prevBodies?.get(id) ?? null;
    const prevCascadedBody = prevCascaded?.get(id) ?? null;

    // Incremental reuse: the renderer hands back the SAME body RenderNode when
    // the body's whole subtree is unchanged → reuse its cascaded tree by ref.
    if (
      dirtyIds !== undefined &&
      prevBody !== null &&
      prevCascadedBody !== null &&
      body === prevBody
    ) {
      out.set(id, prevCascadedBody);
      continue;
    }

    // Re-cascade: incremental when a prior body + prior cascaded body exist
    // (reuses unchanged inner subtrees by ref), else a full cascade.
    const cascaded =
      dirtyIds !== undefined && prevBody !== null && prevCascadedBody !== null
        ? cascadePassIncremental(body, prevBody, prevCascadedBody)
        : cascadePass(body);
    if (cascaded.type !== "element") {
      throw new Error(`${opName}: body "${id}" cascaded to a non-element node`);
    }
    out.set(id, cascaded);
  }
  return out;
}
