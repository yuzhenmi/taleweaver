/**
 * Y.Doc-backed `createEmptyDocument`. Produces a minimal valid document:
 * a `document` root block containing one empty `paragraph` child block.
 * Uses the production BlockId allocator by default; tests can inject a
 * deterministic allocator.
 */
import type { IdAllocator } from "./block-id";
import { productionAllocator } from "./block-id";
import { createState, type State } from "./state";
import { runTransaction, getBlocksMap } from "./yjs-doc";
import { buildYBlock } from "./y-block";
import { STATE_INTERNAL } from "./state-internal";

export interface CreateEmptyDocumentArgs {
  allocator?: IdAllocator;
}

/**
 * Build an empty document State: a root "document" block containing one
 * empty "paragraph" child. The document is the canonical starting point
 * for a new editor session.
 */
export function createEmptyDocument(args: CreateEmptyDocumentArgs = {}): State {
  const allocator = args.allocator ?? productionAllocator;
  const rootId = allocator.allocate();
  const paragraphId = allocator.allocate();

  const state = createState({ rootId });
  const doc = state[STATE_INTERNAL].doc;
  runTransaction(doc, () => {
    const yBlocks = getBlocksMap(doc);
    yBlocks.set(
      rootId,
      buildYBlock({
        type: "document",
        attrs: {},
        parentId: null,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: paragraphId,
        lastChildId: paragraphId,
        inlineContent: null,
      }),
    );
    yBlocks.set(
      paragraphId,
      buildYBlock({
        type: "paragraph",
        attrs: {},
        parentId: rootId,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: null,
        lastChildId: null,
        inlineContent: { items: [] },
      }),
    );
  });
  return state;
}
