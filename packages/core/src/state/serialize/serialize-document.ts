import type { State } from "../state";
import type { SerializedDocument } from "./document-serializer";
import { UnknownSerializerFormatError } from "./document-serializer";
import type { SerializerRegistry } from "./serializer-registry";

/**
 * Engine-level serialize dispatch: look up the serializer for `format` in
 * `registry` and encode `state` to its wire format. Throws
 * `UnknownSerializerFormatError` when no serializer is registered. Pure — the
 * host owns where the bytes go (DB row, file, network).
 */
export function serializeDocument(
  state: State,
  format: string,
  registry: SerializerRegistry,
): SerializedDocument {
  const serializer = registry.get(format);
  if (serializer === undefined) {
    throw new UnknownSerializerFormatError(format);
  }
  return serializer.encode(state);
}

/**
 * Engine-level deserialize dispatch: look up the serializer for `format` in
 * `registry` and decode `source` back to a `State`. Throws
 * `UnknownSerializerFormatError` when no serializer is registered (a serializer
 * may additionally throw `MalformedDocumentError` for structurally-invalid
 * wire data). Pure — the host owns where the bytes came from.
 */
export function deserializeDocument(
  source: SerializedDocument,
  format: string,
  registry: SerializerRegistry,
): State {
  const serializer = registry.get(format);
  if (serializer === undefined) {
    throw new UnknownSerializerFormatError(format);
  }
  return serializer.decode(source);
}
