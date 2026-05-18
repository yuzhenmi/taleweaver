/**
 * Y.Doc-backed `createEmptyDocument` (P4e). Parallel to
 * `./initial-state.ts` (legacy, returns `StateNode`); the two coexist
 * through the P11.4 cutover per Decision D's parallel-window strategy.
 * At cutover, the legacy file is deleted and this file is renamed to
 * `initial-state.ts` (taking the canonical name). Until then, P5+
 * phases inside `packages/core` deep-import this module directly when
 * they need the Y.Doc-backed empty document.
 */
import type { IdAllocator } from "./block-id";
import { productionAllocator } from "./block-id";
import { createState, type State } from "./state";
import { runTransaction, getBlocksMap } from "./yjs-doc";
import { buildYBlock } from "./y-block";

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
  runTransaction(state.doc, () => {
    const yBlocks = getBlocksMap(state.doc);
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
