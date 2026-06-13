import type { EditorState, EditorConfig } from "./editor-state";
import { createEditorStateFromState } from "./editor-state";
import { initialSelectionForState } from "./actions";
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
  return serializeDocument(editor.state, format, registry);
}

/**
 * Load a serialized document into a fresh `EditorState` — the engine-level
 * "open document" operation. Deserializes via the registry, derives a valid
 * initial caret (`initialSelectionForState`), and builds the full editor
 * (fresh History bound to the loaded State + render/cascade/layout) via
 * `createEditorStateFromState`. Throws `UnknownSerializerFormatError` for an
 * unregistered format / `MalformedDocumentError` for invalid wire data (both
 * surfaced from the serializer's decode).
 */
export function loadDocument(
  source: SerializedDocument,
  format: string,
  registry: SerializerRegistry,
  config: EditorConfig,
): EditorState {
  const state = deserializeDocument(source, format, registry);
  const selection = initialSelectionForState(state);
  return createEditorStateFromState(state, selection, config);
}
