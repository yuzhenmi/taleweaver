import type { IdAllocator } from "./block-id";
import { createBlock } from "./block";
import { createInlineContent } from "./inline-content";
import { createPersistentMap } from "./persistent-map";
import { createState, type State } from "./state";

/**
 * Build the minimum valid document: a document root with a single empty
 * paragraph child. Both blocks have fresh ids from the allocator.
 */
export function createEmptyDocument(allocator: IdAllocator): State {
  const docId = allocator.allocate();
  const paraId = allocator.allocate();

  const para = createBlock({
    id: paraId,
    type: "paragraph",
    parentId: docId,
    inlineContent: createInlineContent([]),
  });

  const doc = createBlock({
    id: docId,
    type: "document",
    firstChildId: paraId,
    lastChildId: paraId,
  });

  const blocks = createPersistentMap([
    [docId, doc] as const,
    [paraId, para] as const,
  ]);

  return createState({ rootId: docId, blocks });
}
