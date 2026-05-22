import type * as Y from "yjs";
import type { BlockId } from "./block-id";
import { getBlocksMap, getEmbedContentsMap } from "./yjs-doc";
import { isDevMode } from "./dev-mode";

/**
 * Dev-mode guard: assert that `newId` does NOT already exist in either the
 * blocks map or the embed-contents map of `doc`. Throws a clear, contextual
 * error if the allocator returned a colliding id.
 *
 * Why: production allocators use `crypto.randomUUID` so collisions are
 * vanishingly unlikely. Test allocators (counter-based) CAN collide if a
 * test seeds blocks with names that overlap the counter range. Without this
 * guard, the colliding `Y.Map.set(newId, ...)` would silently overwrite the
 * existing block — a confusing failure mode for test authors.
 *
 * Compiled away in production (`NODE_ENV === "production"`). In dev/test,
 * runs `O(1)` per call (Y.Map `has`).
 *
 * BlockIds are a single namespace shared across the main blocks tree and
 * the embed-contents tree; both must be checked.
 */
export function assertNoIdCollision(
  doc: Y.Doc,
  newId: BlockId,
  opName: string,
): void {
  if (!isDevMode()) return;
  if (getBlocksMap(doc).has(newId) || getEmbedContentsMap(doc).has(newId)) {
    throw new Error(
      `${opName}: allocator returned a colliding id "${newId}" — already exists in state`,
    );
  }
}
