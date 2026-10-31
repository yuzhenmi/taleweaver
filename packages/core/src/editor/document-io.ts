import type { Editor } from "./editor";
import type { EditorConfig } from "./editor-config";
import { createEditor } from "./editor";
import {
  serializeDocument,
  deserializeDocument,
  type SerializedDocument,
  type SerializerRegistry,
} from "../state";

/**
 * Serialize the editor's current document to the wire format `format` via the
 * given registry. Thin convenience over the engine's `serializeDocument`
 * (host: persist the returned bytes/string). Throws `UnknownSerializerFormatError`
 * if `format` is not registered.
 */
export function exportDocument(
  editor: Editor,
  format: string,
  registry: SerializerRegistry,
): SerializedDocument {
  return serializeDocument(editor.document, format, registry);
}

/**
 * Load a serialized document into a fresh `Editor` — the engine-level
 * "open document" operation. Deserializes via the registry, derives a valid
 * initial caret (`initialSelectionForDocument`), and builds the full editor
 * (fresh History bound to the loaded Document + render/cascade/layout) via
 * `createEditor`. Throws `UnknownSerializerFormatError` for an
 * unregistered format / `MalformedDocumentError` for invalid wire data (both
 * surfaced from the serializer's decode).
 */
export function loadDocument(
  source: SerializedDocument,
  format: string,
  registry: SerializerRegistry,
  config: EditorConfig,
): Editor {
  return createEditor(config, { document: deserializeDocument(source, format, registry) });
}
