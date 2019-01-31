import TaleWeaver from '../../TaleWeaver';
import State from '../State';
import Cursor from '../../cursor/Cursor';

type InlineElementJSON = {
  type: string;
  text: string;
}
type BlockElementJSON = {
  type: string;
  children: InlineElementJSON[];
}
type DocumentElementJSON = {
  children: BlockElementJSON[];
}
type CursorJSON = {
  anchor: number;
  head: number;
}
type StateJSON = {
  document: DocumentElementJSON;
  editorCursor: CursorJSON | null;
  observerCursors: CursorJSON[];
}

/**
 * Parses a JSON-serialized state.
 * @param taleWeaver - TaleWeaver instance.
 * @param stateJSON - JSON-serialized state to parse.
 */
export default function parseStateJSON(taleWeaver: TaleWeaver, stateJSON: StateJSON): State {
  // Create state
  const state = new State(taleWeaver);

  // Parse document state
  const registry = taleWeaver.getRegistry();
  const DocumentElement = registry.getDocumentElementClass();
  const documentElement = new DocumentElement();
  stateJSON.document.children.forEach(blockElementJSON => {
    const BlockElement = registry.getBlockElementClass(blockElementJSON.type);
    const blockElement = new BlockElement();
    blockElementJSON.children.forEach(inlineElementJSON => {
      const InlineElement = registry.getInlineElementClass(inlineElementJSON.type);
      const inlineElement = new InlineElement();
      inlineElement.setText(inlineElementJSON.text);
      blockElement.appendChild(inlineElement);
    });
    documentElement.appendChild(blockElement);
  });
  state.setDocumentElement(documentElement);

  // Parse editor cursor state
  if (stateJSON.editorCursor) {
    const editorCursor = new Cursor(stateJSON.editorCursor.anchor, stateJSON.editorCursor.head);
    state.setEditorCursor(editorCursor);
  }

  // Parse observer cursors states
  stateJSON.observerCursors.forEach(observerCursorJSON => {
    const observerCursor = new Cursor(observerCursorJSON.anchor, observerCursorJSON.head);
    state.appendObserverCursor(observerCursor);
  });

  return state;
}
