/**
 * Branded string identifying a block. Brand prevents passing arbitrary
 * strings where BlockIds are expected.
 */

declare const crypto: { randomUUID(): string };

export type BlockId = string & { readonly __brand: "BlockId" };

/**
 * Coerce an open-schema value (e.g. a metadata bag entry or `view.attrs`
 * lookup) to a `BlockId`. A string is kept (branded as a BlockId); anything
 * else — `undefined`, `null`, a number, an object — becomes `undefined`. Used
 * where block-id references ride through untyped channels (the section /
 * document component's header/footer attrs → ElementBox `metadata` → the
 * section plan), so a missing or malformed value degrades to "no id" rather
 * than throwing. Does NOT validate that the id refers to an existing block —
 * it only narrows the type.
 */
export function coerceBlockId(value: unknown): BlockId | undefined {
  return typeof value === "string" ? (value as BlockId) : undefined;
}

/**
 * Brand a string already known (via a `typeof` guard) to be a BlockId; keeps
 * the no-bare-cast rule literal at validated boundaries.
 */
export function asBlockId(value: string): BlockId {
  return value as BlockId;
}

/**
 * Allocates BlockIds. Production uses crypto.randomUUID(); tests inject
 * a deterministic counter-based allocator via createTestAllocator.
 */
export interface IdAllocator {
  allocate(): BlockId;
}

export const productionAllocator: IdAllocator = {
  allocate: () => crypto.randomUUID() as BlockId,
};

/**
 * Mint a fresh list id. List ids are a plain-string namespace, DISTINCT from
 * block ids (a `listId` groups a run of `list-item` blocks; it is not itself a
 * block). Minting here co-locates id generation with the block-id allocator and
 * reuses the same ambient `crypto`, while keeping the two namespaces typed apart
 * (this returns `string`, not the branded `BlockId`).
 */
export function newListId(): string {
  return crypto.randomUUID();
}

/**
 * Creates a deterministic allocator for tests.
 * Each call to allocate() returns `${prefix}-${n}` where n increments from 0.
 */
export function createTestAllocator(prefix = "blk"): IdAllocator {
  let n = 0;
  return { allocate: () => `${prefix}-${n++}` as BlockId };
}
