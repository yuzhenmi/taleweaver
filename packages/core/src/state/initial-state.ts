/**
 * Y.Doc-backed `createEmptyDocument`. Produces a minimal valid document:
 * a `document` root block containing one empty `paragraph` child block.
 * Uses the production BlockId allocator by default; tests can inject a
 * deterministic allocator.
 */
import type { IdAllocator } from "./block-id";
import type { BlockKindResolver } from "./block-kinds";
import { productionAllocator } from "./block-id";
import { createState, type Document } from "./state";
import { writeRoot } from "./flow-ops";
import { STATE_INTERNAL } from "./state-internal";

export interface CreateEmptyDocumentArgs {
  /** Storage-shape authority (the component registry). */
  resolver: BlockKindResolver;
  allocator?: IdAllocator;
}

/**
 * Build an empty document State: a root "document" block containing one
 * empty "paragraph" child. The document is the canonical starting point
 * for a new editor session.
 */
export function createEmptyDocument(args: CreateEmptyDocumentArgs): Document {
  const allocator = args.allocator ?? productionAllocator;
  const rootId = allocator.allocate();
  const paragraphId = allocator.allocate();

  const state = createState({ rootId, resolver: args.resolver });
  const doc = state[STATE_INTERNAL].doc;
  doc.transact(() => {
    writeRoot(
      doc,
      {
        id: rootId,
        type: "document",
        attrs: {},
        inlineContent: null,
        children: [{ id: paragraphId, type: "paragraph", attrs: {}, inlineContent: { items: [] }, children: [] }],
      },
      "block",
    );
  });
  return state;
}
