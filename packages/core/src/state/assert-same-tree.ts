import type { State, ResolvedBlockKind } from "./state";
import { resolveBlock } from "./state";
import type { BlockId } from "./block-id";
import { isDevMode } from "./dev-mode";

/**
 * Dev-mode single-tree invariant guard for the STRUCTURAL Layer-3 ops
 * (split / merge / delete-range) — the ones that rewire sibling/parent
 * pointers across multiple blocks and so could, if a bug crept in, write a
 * pointer that straddles two top-level trees (main `blocks`, `embedContents`,
 * `templateContents`).
 *
 * After such an op resolves its reference block's owning tree
 * (`resolveBlock(state, refId).kind`), it threads that single `kind` to every
 * `getYBlock` / `getTreeMap` write. That is only correct if all the neighbor
 * ids it reads + rewires (the sibling / parent ids) live in the SAME tree — a
 * cross-tree pointer would mean the op writes a `prevSiblingId` / `lastChildId`
 * into the wrong map (state corruption). The block-tree invariant guarantees a
 * subtree never spans trees, so in correct code this always holds; this guard
 * is a cheap tripwire that surfaces the violation with the op name + offending
 * id rather than letting it silently corrupt state.
 *
 * `neighborIds` is the set of sibling / parent ids the op is about to touch;
 * `null` entries (no sibling / no parent) are skipped. Each non-null id must
 * resolve to `expectedKind`; the FIRST mismatch (different tree, or unresolved)
 * throws a descriptive error.
 *
 * Compiled away in production (`NODE_ENV === "production"` → no-op). In
 * dev/test, O(neighbors) with an O(1) `resolveBlock` per neighbor.
 */
export function assertSameTree(
  state: State,
  expectedKind: ResolvedBlockKind,
  neighborIds: ReadonlyArray<BlockId | null>,
  opName: string,
): void {
  if (!isDevMode()) return;
  for (const id of neighborIds) {
    if (id === null) continue;
    const resolved = resolveBlock(state, id);
    if (resolved === null) {
      throw new Error(
        `${opName}: neighbor block "${id}" resolves to no tree — expected it in the ` +
          `"${expectedKind}" tree; the op is about to write across trees (state corruption).`,
      );
    }
    if (resolved.kind !== expectedKind) {
      throw new Error(
        `${opName}: neighbor block "${id}" lives in the "${resolved.kind}" tree but the ` +
          `reference block is in the "${expectedKind}" tree; the op is about to write ` +
          `across trees (state corruption).`,
      );
    }
  }
}
