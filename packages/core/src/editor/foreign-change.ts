import type * as Y from "yjs";
import {
  resolveBlock,
  createPosition,
  createSpan,
  selectionContextOf,
  positionsEqual,
} from "../state";
import type { BlockId, Position, Selection, State, IncompatibleDocumentReport } from "../state";
import { peekBlock } from "../state/state";
import { STATE_INTERNAL } from "../state/state-internal";
import { snapOffset } from "../state/y-inline";
import { compatibilityGate, type CompatibilityGateOptions } from "../state/collab";
import { transitionMapping } from "../decorations/decoration-layers";
import { comparePositionsCached, type Assoc } from "../state/position-mapping";
import { initialSelectionForState } from "./actions/helpers/initial-selection-for-state";
import type { EditorState } from "./editor-state";

/**
 * Collaboration: a peer's change arrives in this editor's Y.Doc (via `Y.applyUpdate`
 * from a Yjs provider). `APPLY_FOREIGN_CHANGE` brings the EditorState up to date and
 * rebases the local selection through the change.
 */

/** The Y.Doc behind a document `State` — what a Yjs provider syncs. */
export function getYDoc(state: State): Y.Doc {
  return state[STATE_INTERNAL].doc;
}

/**
 * Call `onRemoteChange(dirtyIds)` after every transaction applied to `state`'s Y.Doc
 * from OUTSIDE (`!transaction.local` — a `Y.applyUpdate` of a peer's update). Local
 * edits, undo / redo and suggestion resolution are local transactions and never
 * reported. A peer change touching only the side tables (comments, suggestions, list
 * definitions) reports the root as dirty. Returns the unsubscribe function.
 *
 * A remote transaction carrying LEGACY inline storage (an old client's update) is
 * shape-checked FIRST (its touched blocks, O(changed)) and reported to
 * `onIncompatible(blockIds)` INSTEAD of `onRemoteChange`: no APPLY_FOREIGN_CHANGE
 * is dispatched for it, and the controller halts (see `LegacyDocumentError`). The
 * subscription stays halted (reporting nothing) until a later transaction — remote,
 * or LOCAL (a host upgrading the shared doc itself) — leaves the document free of
 * legacy storage; then `onCompatible()` is called once (see `compatibilityGate` in
 * `state/collab.ts`).
 */
export function subscribeRemoteChanges(
  state: State,
  onRemoteChange: (dirtyIds: ReadonlySet<BlockId>) => void,
  onIncompatible: (report: IncompatibleDocumentReport) => void,
  onCompatible?: () => void,
  options?: CompatibilityGateOptions,
): () => void {
  const doc = getYDoc(state);
  const gate = compatibilityGate(doc, onIncompatible, onCompatible, options);
  const handler = (tx: Y.Transaction): void => {
    if (tx.changed.size === 0) return;
    const dirtyIds = gate.check(tx, !tx.local);
    if (dirtyIds !== null) onRemoteChange(dirtyIds.size > 0 ? dirtyIds : new Set([state.rootId]));
  };
  doc.on("afterTransaction", handler);
  return () => {
    gate.dispose();
    doc.off("afterTransaction", handler);
  };
}

/**
 * A text-bearing position in `block` of `next`, clamped to its length and snapped
 * back to a grapheme-cluster boundary (a peer's edit can leave an offset inside a
 * surrogate pair / cluster), or null.
 */
function clampInto(next: State, blockId: BlockId, offset: number): Position | null {
  const content = resolveBlock(next, blockId)?.block.inlineContent ?? null;
  if (content === null) return null;
  return createPosition(blockId, snapOffset(content.items, offset));
}

/**
 * The nearest valid position for `pos` (from `prev`) in `next` when mapping could not
 * place it: the same block clamped; else the end of the closest previous sibling that
 * still exists; else the start of the closest next one; else the document start.
 */
function nearestValid(prev: State, next: State, pos: Position): Position {
  const same = clampInto(next, pos.blockId, pos.offset);
  if (same !== null) return same;
  const old = peekBlock(prev, pos.blockId);
  for (let id = old?.prevSiblingId ?? null; id !== null; id = peekBlock(prev, id)?.prevSiblingId ?? null) {
    const p = clampInto(next, id, Number.MAX_SAFE_INTEGER);
    if (p !== null) return p;
  }
  for (let id = old?.nextSiblingId ?? null; id !== null; id = peekBlock(prev, id)?.nextSiblingId ?? null) {
    const p = clampInto(next, id, 0);
    if (p !== null) return p;
  }
  return initialSelectionForState(next).focus;
}

/**
 * Whether `anchor` precedes `focus` in the PRE-change document. That State is superseded
 * (its Y.Doc already holds the peer's change), so it is read cache-only; unknown → forward.
 */
function isForward(prev: State, anchor: Position, focus: Position): boolean {
  return (comparePositionsCached(prev, anchor, focus) ?? 0) <= 0;
}

/**
 * Rebase `before.selection` onto `after.state` through the transition: a collapsed
 * caret sticks to the content before it (assoc −1, so a peer typing at the caret does
 * not push it), a range keeps its content (from +1, to −1). Unmappable endpoints go to
 * the nearest valid position; endpoints that end up in different selection contexts
 * collapse to the focus.
 */
export function rebaseSelection(before: EditorState, after: EditorState): Selection {
  const { anchor, focus } = before.selection;
  const mapping = transitionMapping(before, after);
  const collapsed = positionsEqual(anchor, focus);
  const map = (p: Position, assoc: Assoc): Position => {
    const mapped = mapping.map(p, assoc).position;
    return mapped === null ? nearestValid(before.state, after.state, p) : (clampInto(after.state, mapped.blockId, mapped.offset) ?? mapped);
  };
  if (collapsed) {
    const caret = map(focus, -1);
    return createSpan(caret, caret);
  }
  const forward = isForward(before.state, anchor, focus);
  const a = map(anchor, forward ? 1 : -1);
  const f = map(focus, forward ? -1 : 1);
  const ctxA = selectionContextOf(after.state, a.blockId);
  if (ctxA === null || ctxA !== selectionContextOf(after.state, f.blockId)) return createSpan(f, f);
  return createSpan(a, f);
}
