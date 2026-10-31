import type * as Y from "yjs";
import type { Document } from "./document";
import type { BlockId } from "./block-id";
import { DOCUMENT_INTERNAL } from "./document-internal";
import { UntrackedOrigin, dirtyIdsFromTransaction } from "./yjs-doc";
import {
  inspectDocument,
  legacyBlocksTouched,
  legacyTextOf,
  legacyWritesSinceUpgrade,
  markLegacySurfaced,
  CURRENT_SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  type IncompatibleDocumentReport,
} from "./upgrade";
import { getMetaMap } from "./yjs-doc";
import { foreignStructSeen, transactionStructs } from "./mark-index";

/**
 * The collaboration seam: subscribe to FOREIGN changes on this `Document`'s shared
 * `Y.Doc`. Fires `onForeignChange(dirtyIds)` for every transaction whose
 * `origin !== selfOrigin` that touched at least one block — so a host (e.g. a
 * second editor controller bound to the SAME doc) can mint
 * `freshDocument(state, dirtyIds)` and relayout exactly the changed blocks when a
 * remote peer edits the document.
 *
 * Yjs is a CRDT, so two `Document`s over one shared `Y.Doc` (or two docs exchanging
 * `Y.encodeStateAsUpdate`/`Y.applyUpdate` messages) converge automatically; the
 * only missing piece for a live editor is *noticing* a foreign mutation and
 * re-rendering. This is that notice. Transport (WebSocket / MessageChannel /
 * in-memory shared doc) is the host's concern — this observer reacts to whatever
 * lands on the doc.
 *
 * **The origin filter is load-bearing.** A controller's OWN edit also fires
 * `afterTransaction` — synchronously, DURING its in-flight `applyOperation`,
 * before its new `Document` exists — so reacting to self here is both redundant
 * (`applyOperation` already returns the fresh Document) and racy. Each collab host
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
  document: Document,
  selfOrigin: unknown,
  onForeignChange: (dirtyIds: ReadonlySet<BlockId>) => void,
  onIncompatible: (report: IncompatibleDocumentReport) => void,
  onCompatible?: () => void,
  options?: CompatibilityGateOptions,
): () => void {
  const { doc } = document[DOCUMENT_INTERNAL];
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
 * The compatibility gate shared by `subscribeForeignChanges` and
 * `subscribeRemoteChanges`. It HALTS (calling `onIncompatible(report)` once) when a
 * transaction:
 *   - touches a type under a FROZEN legacy root (a legacy peer wrote after the
 *     upgrade): the report carries the touched legacy blocks and their current
 *     legacy text — surfaced, not merged (sticky);
 *   - carries a struct decoded by a second Yjs instance (sticky);
 *   - raises `meta.schemaVersion` past this engine's (sticky).
 * A gate that starts halted on a not-yet-upgraded document resumes
 * (`onCompatible()`) once it is upgraded. While halted every transaction is
 * withheld. Detection is O(changed) per transaction; a legacy write that landed
 * before the gate started (no transaction to see) is found once at start by
 * comparing the frozen roots with the upgrade's baseline (O(legacy content)).
 */
export function compatibilityGate(
  doc: Y.Doc,
  onIncompatible: (report: IncompatibleDocumentReport) => void,
  onCompatible: (() => void) | undefined,
  options: CompatibilityGateOptions | undefined,
): CompatibilityGate {
  /** Why the gate is halted: a not-yet-upgraded document (resumable) or a sticky incompatibility. */
  let halted: "schema" | "sticky" | null = null;
  /** Bumped on every halt / resume / dispose: a stale start-up `onCompatible` is dropped. */
  let epoch = 0;
  const schemaOk = (): boolean => inspectDocument(doc).schemaVersion === CURRENT_SCHEMA_VERSION;
  if (options?.startHalted === true) {
    if (!schemaOk()) halted = "schema";
    else {
      const at = epoch;
      void Promise.resolve().then(() => {
        if (epoch === at) onCompatible?.();
      });
    }
  }
  const halt = (report: IncompatibleDocumentReport): null => {
    halted = "sticky";
    epoch++;
    if (report.reason === "legacy-write") markLegacySurfaced(doc);
    onIncompatible(report);
    return null;
  };
  const legacyReport = (touched: readonly BlockId[]): IncompatibleDocumentReport => {
    const legacyText: Record<string, string> = {};
    for (const id of touched) legacyText[id] = legacyTextOf(doc, id) ?? "";
    return { reason: "legacy-write", legacyBlocks: touched, legacyText };
  };
  // A legacy write that landed before this gate started watching (between the upgrade /
  // `createDocument` and the subscription) carries no transaction to see: compare the frozen
  // roots against the upgrade's baseline once, at start (O(legacy content)).
  if (halted === null && schemaOk()) {
    const early = legacyWritesSinceUpgrade(doc);
    if (early.length > 0) {
      halted = "sticky";
      const at = ++epoch;
      void Promise.resolve().then(() => {
        if (epoch !== at) return;
        markLegacySurfaced(doc);
        onIncompatible(legacyReport(early));
      });
    }
  }
  return {
    check(tx, watched) {
      if (halted === "sticky") return null;
      if (halted === "schema") {
        if (schemaOk()) {
          halted = null;
          epoch++;
          onCompatible?.();
        }
        return null;
      }
      transactionStructs(tx);
      if (foreignStructSeen(doc)) return halt({ reason: "second-yjs-instance", legacyBlocks: [], legacyText: {} });
      const touched = legacyBlocksTouched(doc, tx);
      if (touched.length > 0) return halt(legacyReport(touched));
      const v = getMetaMap(doc).get(SCHEMA_VERSION_KEY);
      if (typeof v === "number" && v > CURRENT_SCHEMA_VERSION) {
        return halt({ reason: "newer-schema", legacyBlocks: [], legacyText: {} });
      }
      if (!watched) return null;
      return dirtyIdsFromTransaction(doc, tx);
    },
    dispose() {
      epoch++;
    },
  };
}
