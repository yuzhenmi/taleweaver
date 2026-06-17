/**
 * The `serialize/` module barrel — the pluggable document (de)serialization
 * surface. Lives INSIDE `state/` because it consumes/produces `State` and needs
 * the raw `Y.Doc` (reached via `STATE_INTERNAL` by sibling import, exactly like
 * `build-state-from-blocks` / `list-defs` / `initial-state`). `getMetaRootId`
 * (yjs-doc) stays state-private and is NOT re-exported here.
 */

export type {
  SerializedDocument,
  DocumentSerializer,
} from "./document-serializer";
export {
  UnknownSerializerFormatError,
  MalformedDocumentError,
} from "./document-serializer";

export type { SerializerRegistry } from "./serializer-registry";
export {
  createSerializerRegistry,
  createDefaultSerializerRegistry,
} from "./serializer-registry";

export { serializeDocument, deserializeDocument } from "./serialize-document";

export { createBinaryDocumentSerializer, BINARY_FORMAT } from "./binary-serializer";

export type {
  JsonNode,
  JsonInlineItem,
  JsonTextItem,
  JsonEmbedItem,
  JsonDocument,
} from "./json-serializer";
export { createJsonDocumentSerializer, JSON_FORMAT } from "./json-serializer";

export type { HtmlNode, HtmlParser } from "./html-node";
export { encodeHtml } from "./html-encode";
export { decodeHtml } from "./html-decode";
export {
  createHtmlDocumentSerializer,
  HTML_FORMAT,
} from "./html-serializer";
