/**
 * Branded string identifying a block. Brand prevents passing arbitrary
 * strings where BlockIds are expected.
 */

declare const crypto: { randomUUID(): string };

export type BlockId = string & { readonly __brand: "BlockId" };

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
