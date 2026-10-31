import type { Document } from "../document";
import type { SerializedDocument } from "./document-serializer";
import { UnknownSerializerFormatError } from "./document-serializer";
import type { SerializerRegistry } from "./serializer-registry";

/**
 * Engine-level serialize dispatch: look up the serializer for `format` in
 * `registry` and encode `document` to its wire format. Throws
 * `UnknownSerializerFormatError` when no serializer is registered. Pure — the
 * host owns where the bytes go (DB row, file, network).
 */
export function serializeDocument(
  document: Document,
  format: string,
  registry: SerializerRegistry,
): SerializedDocument {
  const serializer = registry.get(format);
  if (serializer === undefined) {
    throw new UnknownSerializerFormatError(format);
  }
  return serializer.encode(document);
}

/**
 * Engine-level deserialize dispatch: look up the serializer for `format` in
 * `registry` and decode `source` back to a `Document`. Throws
 * `UnknownSerializerFormatError` when no serializer is registered (a serializer
 * may additionally throw `MalformedDocumentError` for structurally-invalid
 * wire data). Pure — the host owns where the bytes came from.
 */
export function deserializeDocument(
  source: SerializedDocument,
  format: string,
  registry: SerializerRegistry,
): Document {
  const serializer = registry.get(format);
  if (serializer === undefined) {
    throw new UnknownSerializerFormatError(format);
  }
  return serializer.decode(source);
}
