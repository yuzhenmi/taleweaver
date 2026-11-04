import type * as Y from "yjs";

// ---------------------------------------------------------------------------
// Ids (X21: block id = Yjs item id)
// ---------------------------------------------------------------------------

export function itemId(item: Y.Item): string {
  return `${item.id.client}:${item.id.clock}`;
}

/** Anything with a Yjs item (every integrated shared type). */
export interface HasItem {
  readonly _item: Y.Item | null;
}

/** The item id of an integrated type, or null when detached. */
export function typeId(t: HasItem): string | null {
  return t._item === null ? null : itemId(t._item);
}
