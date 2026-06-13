import * as Y from "yjs";
import { createState, type State } from "../state";
import { STATE_INTERNAL } from "../state-internal";
import { getMetaRootId } from "../yjs-doc";
import type { DocumentSerializer } from "./document-serializer";
import { MalformedDocumentError } from "./document-serializer";

/**
 * Stable format id for the v1 lossless Yjs-binary serializer. A future format
 * change ships a NEW id — old bytes are NEVER reinterpreted under a different
 * meaning.
 */
export const BINARY_FORMAT = "taleweaver-binary";

/**
 * The v1 document serializer: a lossless binary round-trip backed by Yjs's
 * native update format. State is Yjs-native — `Y.encodeStateAsUpdate(doc)`
 * captures the ENTIRE Y.Doc (all three block trees + listDefs + meta) into a
 * single `Uint8Array`, and `Y.applyUpdate(freshDoc, update)` rebuilds it
 * exactly. The per-State snapshot cache is intentionally NOT serialized: it is
 * derived (a read-side cache over the Y.Doc), so a freshly-decoded State
 * correctly starts with an empty cache.
 *
 * Uses the **v1** update codec (`encodeStateAsUpdate`/`applyUpdate`), not v2 —
 * v1 is the format Yjs's own ecosystem (y-* bindings) treats as the stable
 * interchange unit.
 */
export function createBinaryDocumentSerializer(): DocumentSerializer<Uint8Array> {
  return {
    format: BINARY_FORMAT,
    encode(state: State): Uint8Array {
      // Whole Y.Doc: blocks + embedContents + templateContents + listDefs + meta.
      return Y.encodeStateAsUpdate(state[STATE_INTERNAL].doc);
    },
    decode(update: Uint8Array): State {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, update);
      const rootId = getMetaRootId(doc);
      if (rootId === undefined) {
        throw new MalformedDocumentError(BINARY_FORMAT);
      }
      // createState is idempotent on already-seeded meta (it only writes rootId
      // when absent); the fresh empty snapshotCache is correct — it is derived,
      // not serialized.
      return createState({ rootId, doc });
    },
  };
}
