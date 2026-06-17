import { resolveBlock, positionsEqual } from "../state";
import type { State, Selection, BlockId, BlockKindResolver } from "../state";

/**
 * Object-selection predicate: returns the selected atomic-leaf block id when
 * `selection` is a COLLAPSED selection positioned at offset 0 of an atomic-leaf
 * block (image / horizontal-line), else null. By engine convention, the
 * cursor-placement actions position a collapsed selection at offset 0 of an
 * atomic-leaf block to represent "this object is selected"; no action in the
 * normal editing pipeline puts a text caret at offset 0 of an atomic-leaf (it
 * carries no text), so this position is a reliable discriminant for selections
 * produced by the normal pipeline.
 *
 * Resolves the block CROSS-TREE via `resolveBlock` (main body + footnote/embed
 * bodies + header/footer/template bodies) so the gate agrees with
 * `getAtomicBoxIndex`, which indexes atomic boxes in every tree — otherwise a
 * (future) atomic leaf in a header/footnote body would be hit-testable as an
 * object yet rejected by this gate, desyncing click→select from the action
 * guards. A main-tree block resolves identically through `resolveBlock`.
 */
export function isObjectSelection(
  state: State,
  selection: Selection,
  resolver: BlockKindResolver,
): BlockId | null {
  if (!positionsEqual(selection.anchor, selection.focus)) return null;
  if (selection.focus.offset !== 0) return null;
  const resolved = resolveBlock(state, selection.focus.blockId);
  if (resolved === null) return null;
  return resolver.getBlockKind(resolved.block.type) === "atomic-leaf"
    ? resolved.block.id
    : null;
}
