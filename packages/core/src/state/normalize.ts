import type { StateNode } from "./state-node";
import { createNode, createTextNode } from "./create-node";
import { getTextContent } from "./text-utils";

/** Non-text block types that are considered "opaque" for normalization. */
const OPAQUE_TYPES = new Set(["table"]);

/** Returns true if the node is a void block (no children) or a known opaque type like table. */
export function isOpaqueBlock(node: StateNode): boolean {
  if (OPAQUE_TYPES.has(node.type)) return true;
  // Void blocks have no children (e.g. horizontal-line, image)
  return node.children.length === 0;
}

/**
 * Returns true if the block at `blockIdx` is a structural paragraph —
 * an empty paragraph that exists solely to provide a cursor position
 * between/adjacent to opaque blocks.
 */
export function isStructuralParagraph(
  state: StateNode,
  blockIdx: number,
): boolean {
  const block = state.children[blockIdx];
  if (!block || block.type !== "paragraph") return false;

  // Must be empty (single empty text child)
  if (
    block.children.length !== 1 ||
    block.children[0].type !== "text" ||
    getTextContent(block.children[0]) !== ""
  ) {
    return false;
  }

  const prev = blockIdx > 0 ? state.children[blockIdx - 1] : undefined;
  const next = blockIdx < state.children.length - 1 ? state.children[blockIdx + 1] : undefined;

  const prevOpaque = prev ? isOpaqueBlock(prev) : false;
  const nextOpaque = next ? isOpaqueBlock(next) : false;

  // Structural if between two opaques, or at boundary adjacent to an opaque
  if (prevOpaque && nextOpaque) return true;
  if (blockIdx === 0 && nextOpaque) return true;
  if (blockIdx === state.children.length - 1 && prevOpaque) return true;

  return false;
}

/**
 * Normalize a document by inserting empty paragraphs between adjacent opaque
 * blocks and at document boundaries adjacent to opaque blocks.
 *
 * Returns the same reference if no changes are needed (structural sharing).
 */
export function normalizeDocument(
  state: StateNode,
  allocateId: () => string,
): StateNode {
  const children = state.children;
  const result: StateNode[] = [];
  let changed = false;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const isOpaque = isOpaqueBlock(child);

    // If this is an opaque block at position 0, or preceded by another opaque block,
    // insert an empty paragraph before it
    if (isOpaque) {
      const prev = result.length > 0 ? result[result.length - 1] : undefined;
      const needsParagraphBefore =
        result.length === 0 || (prev !== undefined && isOpaqueBlock(prev));

      if (needsParagraphBefore) {
        const textId = allocateId();
        const paraId = allocateId();
        result.push(createNode(paraId, "paragraph", {}, [createTextNode(textId, "")]));
        changed = true;
      }
    }

    result.push(child);
  }

  // If last child is opaque, insert an empty paragraph at the end
  if (result.length > 0 && isOpaqueBlock(result[result.length - 1])) {
    const textId = allocateId();
    const paraId = allocateId();
    result.push(createNode(paraId, "paragraph", {}, [createTextNode(textId, "")]));
    changed = true;
  }

  if (!changed) return state;

  return createNode(state.id, state.type, { ...state.properties }, result);
}
