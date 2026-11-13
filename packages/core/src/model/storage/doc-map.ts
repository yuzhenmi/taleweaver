import * as Y from "yjs";
import { BODIES_KEY, COMMENTS_KEY, DOC_KEY, FLOW_KEY, LIST_DEFS_KEY, META_MAP, ROOT_MAP, SCHEMA_VERSION, SCHEMA_VERSION_KEY, SUGGESTIONS_KEY } from "./keys";
import { mapOf, newFlow } from "./new-items";

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

/** The DocMap, or null for a document with no schema-4 root. */
export function getDocMap(doc: Y.Doc): Y.Map<unknown> | null {
  const m = doc.getMap(ROOT_MAP).get(DOC_KEY);
  return m instanceof Y.Map ? m : null;
}

/** Create the schema-4 root (one transaction): DocMap with a one-¶ body flow, side maps, `meta.schemaVersion = 4`. */
export function createDocMap(doc: Y.Doc, origin: unknown = null): Y.Map<unknown> {
  if (getDocMap(doc) !== null) throw new Error("schema4: document already has a root");
  const docMap = mapOf({
    [FLOW_KEY]: newFlow(),
    [BODIES_KEY]: new Y.Map<unknown>(),
    [LIST_DEFS_KEY]: new Y.Map<unknown>(),
    [COMMENTS_KEY]: new Y.Map<unknown>(),
    [SUGGESTIONS_KEY]: new Y.Map<unknown>(),
  });
  doc.transact(() => {
    doc.getMap(ROOT_MAP).set(DOC_KEY, docMap);
    doc.getMap(META_MAP).set(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
  }, origin);
  return docMap;
}
