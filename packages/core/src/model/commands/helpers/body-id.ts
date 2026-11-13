import * as Y from "yjs";

/** A header / footer body id unique in the document: this client's id and next clock (never reused); `n` tells apart several made by one plan. */
export const freshBodyId = (doc: Y.Doc, n = 0): string => `b${doc.clientID}.${Y.getState(doc.store, doc.clientID)}${n === 0 ? "" : `.${n}`}`;
