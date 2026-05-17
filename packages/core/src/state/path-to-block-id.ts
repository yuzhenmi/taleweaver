import type { BlockId } from "./block-id";

/**
 * Deterministic 1:1 encoding from a path (root-to-block index sequence)
 * to a BlockId string. Used during the P11.0 parallel window per
 * decision D: when `rebuildStateFromLegacy` reconstructs `State` from
 * `stateLegacy`, BlockIds are derived from paths so selection survives
 * rebuilds (the path didn't change → the BlockId is the same).
 *
 * Format: `"R"` for the empty path (root); `"R/0/1/2"` for descendant
 * paths. The `"R"` prefix ensures the root id is non-empty (avoiding
 * collision with empty-string sentinels) and makes path-derived ids
 * visually distinguishable from allocator-generated ids (which are
 * UUIDs).
 *
 * At cutover (end of P11.4), a one-time id-translation pass replaces
 * path-derived ids with fresh allocator-generated ids.
 */
export function pathToBlockId(path: ReadonlyArray<number>): BlockId {
  if (path.length === 0) return "R" as BlockId;
  return ("R/" + path.join("/")) as BlockId;
}
