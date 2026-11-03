import * as Y from "yjs";
import { FLOW_KEY, KIND_KEY, PIECES_KEY } from "./keys";

// ---------------------------------------------------------------------------
// History hooks (X16 / X17)
// ---------------------------------------------------------------------------

/** A fresh per-editor transaction origin (X16): undo tracks only this editor's writes. */
export function createEditorOrigin(label = "taleweaver-editor"): symbol {
  return Symbol(label);
}

/**
 * `Y.UndoManager` `deleteFilter` (X17): an undo never deletes a flow container — a
 * piece, a sub-flow (map or its pieces array) or a holder's `flow` array — so a peer's
 * text inside a container this editor created survives the undo. Such a container dies
 * only with its parent (a deleted footnote / body).
 */
export function flowContainerDeleteFilter(item: Y.Item): boolean {
  // An undo filters a map's entries before the map itself (children first), so a sub-flow is
  // recognised by its kept `pieces` array, and its `k` entry is kept too (else it reads inert).
  if (item.parentSub === KIND_KEY && item.parent instanceof Y.Map && isSubflowMap(item.parent)) return false;
  const c = item.content;
  if (!(c instanceof Y.ContentType)) return true;
  const t = c.type;
  if (t instanceof Y.Text && item.parent instanceof Y.Array) return false;
  if (t instanceof Y.Array && (item.parentSub === FLOW_KEY || item.parentSub === PIECES_KEY)) return false;
  if (t instanceof Y.Map && isSubflowMap(t)) return false;
  return true;
}

/** A map embedded in a piece that holds a `pieces` array: a sub-flow (by structure, not by its `k`). */
function isSubflowMap(m: Y.Map<unknown>): boolean {
  return m._item?.parent instanceof Y.Text && m.get(PIECES_KEY) instanceof Y.Array;
}
