import type * as Y from "yjs";
import type { State } from "./state";
import type { BlockId } from "./block-id";
import { STATE_INTERNAL } from "./state-internal";
import { UntrackedOrigin, dirtyIdsFromTransaction } from "./yjs-doc";
import { inspectDocument, legacyBlocksAmong } from "./upgrade";

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
 * token per instance. A host's own UNTRACKED changes (host proposals — not in its
 * undo stack) carry an `UntrackedOrigin` wrapping its origin: that is self too,
 * while a second host on the same doc (another `selfOrigin`) sees it as foreign.
 *
 * **Incompatible storage.** Before anything reads the change, the touched blocks
 * are shape-checked (O(changed)): a transaction that carries LEGACY inline storage
 * (an old client's update) calls `onIncompatible(blockIds)` INSTEAD of
 * `onForeignChange` — the host halts its editor; no read path ever parses legacy
 * storage. The subscription is then HALTED itself: it reports no change, re-checks
 * the known legacy blocks plus the touched ones on EVERY transaction (self or
 * foreign — a host that upgrades the shared doc itself counts), and calls
 * `onCompatible()` once no legacy storage is left, returning to normal reporting.
 * See {@link compatibilityGate}.
 *
 * Returns an unsubscribe — call it on host teardown (it `doc.off`s the listener).
 */
export function subscribeForeignChanges(
  state: State,
  selfOrigin: unknown,
  onForeignChange: (dirtyIds: ReadonlySet<BlockId>) => void,
  onIncompatible: (blockIds: readonly BlockId[]) => void,
  onCompatible?: () => void,
  options?: CompatibilityGateOptions,
): () => void {
  const { doc } = state[STATE_INTERNAL];
  const gate = compatibilityGate(doc, onIncompatible, onCompatible, options);
  const handler = (tx: Y.Transaction): void => {
    const self =
      tx.origin === selfOrigin || (tx.origin instanceof UntrackedOrigin && tx.origin.owner === selfOrigin);
    const dirtyIds = gate.check(tx, !self);
    if (dirtyIds !== null && dirtyIds.size > 0) onForeignChange(dirtyIds);
  };
  doc.on("afterTransaction", handler);
  return () => {
    gate.dispose();
    doc.off("afterTransaction", handler);
  };
}

/** Options of the change subscriptions' compatibility gate. */
export interface CompatibilityGateOptions {
  /**
   * Start HALTED (a host that already knows the document held legacy storage, e.g. a
   * view re-created while its editor is halted): the document is inspected once at
   * subscribe (O(doc)); if it is already compatible (upgraded meanwhile) `onCompatible`
   * is called on a microtask, else nothing is reported until it is compatible again.
   */
  readonly startHalted?: boolean;
}

/** The legacy-shape gate a change subscription runs every transaction through. */
export interface CompatibilityGate {
  /**
   * The touched blocks of `tx` when the change may be reported (`watched` — a
   * transaction the subscription reports), else null. Unwatched transactions are only
   * read while halted (a host upgrading the document itself must resume it).
   */
  check(tx: Y.Transaction, watched: boolean): ReadonlySet<BlockId> | null;
  /** Unsubscribed: a pending start-up `onCompatible` is dropped. */
  dispose(): void;
}

/**
 * The legacy-shape gate shared by `subscribeForeignChanges` and
 * `subscribeRemoteChanges`. Normally it shape-checks a watched transaction's touched
 * blocks (O(changed)); a legacy block HALTS the gate and calls
 * `onIncompatible(blockIds)` once. While halted every transaction — watched or not —
 * is withheld and the known legacy blocks plus the touched ones are re-checked
 * (O(changed + legacy)); once none is left the gate calls `onCompatible()` and reports
 * again from the next transaction.
 */
export function compatibilityGate(
  doc: Y.Doc,
  onIncompatible: (blockIds: readonly BlockId[]) => void,
  onCompatible: (() => void) | undefined,
  options: CompatibilityGateOptions | undefined,
): CompatibilityGate {
  /** The legacy blocks while halted; null while compatible. */
  let legacy: ReadonlySet<BlockId> | null = null;
  /** Bumped on every halt / resume / dispose: a stale start-up `onCompatible` is dropped. */
  let epoch = 0;
  if (options?.startHalted === true) {
    const found = inspectDocument(doc).legacyBlocks;
    if (found.length > 0) legacy = new Set(found);
    else {
      const at = epoch;
      queueMicrotask(() => {
        if (epoch === at) onCompatible?.();
      });
    }
  }
  return {
    check(tx, watched) {
      if (legacy === null && !watched) return null;
      const dirtyIds = dirtyIdsFromTransaction(doc, tx);
      if (legacy !== null) {
        const left = legacyBlocksAmong(doc, new Set([...legacy, ...dirtyIds]));
        if (left.length > 0) legacy = new Set(left);
        else {
          legacy = null;
          epoch++;
          onCompatible?.();
        }
        return null;
      }
      const found = legacyBlocksAmong(doc, dirtyIds);
      if (found.length === 0) return dirtyIds;
      legacy = new Set(found);
      epoch++;
      onIncompatible(found);
      return null;
    },
    dispose() {
      epoch++;
    },
  };
}
