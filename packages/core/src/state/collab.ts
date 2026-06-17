import type * as Y from "yjs";
import type { State } from "./state";
import type { BlockId } from "./block-id";
import { STATE_INTERNAL } from "./state-internal";
import { dirtyIdsFromTransaction } from "./yjs-doc";

/**
 * The collaboration seam: subscribe to FOREIGN changes on this `State`'s shared
 * `Y.Doc`. Fires `onForeignChange(dirtyIds)` for every transaction whose
 * `origin !== selfOrigin` that touched at least one block — so a host (e.g. a
 * second editor controller bound to the SAME doc) can mint
 * `freshState(state, dirtyIds)` and relayout exactly the changed blocks when a
 * remote peer edits the document.
 *
 * Yjs is a CRDT, so two `State`s over one shared `Y.Doc` (or two docs exchanging
 * `Y.encodeStateAsUpdate`/`Y.applyUpdate` messages) converge automatically; the
 * only missing piece for a live editor is *noticing* a foreign mutation and
 * re-rendering. This is that notice. Transport (WebSocket / MessageChannel /
 * in-memory shared doc) is the host's concern — this observer reacts to whatever
 * lands on the doc.
 *
 * **The origin filter is load-bearing.** A controller's OWN edit also fires
 * `afterTransaction` — synchronously, DURING its in-flight `applyOperation`,
 * before its new `State` exists — so reacting to self here is both redundant
 * (`applyOperation` already returns the fresh State) and racy. Each collab host
 * tags its edits with a distinct `selfOrigin` (via `applyOperation`'s `origin`
 * option / `EditorConfig.origin`); this observer ignores those and reacts ONLY to
 * others'. `null`/`undefined` origins (the single-editor default) collapse to one
 * "self" only if the host passes that same value — collab hosts pass a unique
 * token per instance.
 *
 * Returns an unsubscribe — call it on host teardown (it `doc.off`s the listener).
 */
export function subscribeForeignChanges(
  state: State,
  selfOrigin: unknown,
  onForeignChange: (dirtyIds: ReadonlySet<BlockId>) => void,
): () => void {
  const { doc } = state[STATE_INTERNAL];
  const handler = (tx: Y.Transaction): void => {
    if (tx.origin === selfOrigin) return;
    const dirtyIds = dirtyIdsFromTransaction(doc, tx);
    if (dirtyIds.size > 0) onForeignChange(dirtyIds);
  };
  doc.on("afterTransaction", handler);
  return () => {
    doc.off("afterTransaction", handler);
  };
}
