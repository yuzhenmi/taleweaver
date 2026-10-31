import type { EditorState } from "./editor-state";
import type { EditorConfig } from "./editor-config";
import { createEditorStateFromDocument } from "./editor-state";
import { initialSelectionForDocument } from "./actions";
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
  editor: EditorState,
  format: string,
  registry: SerializerRegistry,
): SerializedDocument {
  return serializeDocument(editor.document, format, registry);
}

/**
 * Load a serialized document into a fresh `EditorState` — the engine-level
 * "open document" operation. Deserializes via the registry, derives a valid
 * initial caret (`initialSelectionForDocument`), and builds the full editor
 * (fresh History bound to the loaded Document + render/cascade/layout) via
 * `createEditorStateFromDocument`. Throws `UnknownSerializerFormatError` for an
 * unregistered format / `MalformedDocumentError` for invalid wire data (both
 * surfaced from the serializer's decode).
 */
export function loadDocument(
  source: SerializedDocument,
  format: string,
  registry: SerializerRegistry,
  config: EditorConfig,
): EditorState {
  const document = deserializeDocument(source, format, registry);
  const selection = initialSelectionForDocument(document);
  return createEditorStateFromDocument(document, selection, config);
}
