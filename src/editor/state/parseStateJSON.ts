import TaleWeaver from '../TaleWeaver';
import State from './State';
import Cursor from '../cursor/Cursor';

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

export default function parseStateJSON(taleWeaver: TaleWeaver, stateJSON: StateJSON): State {
  // Create state
  const state = new State();

  // Parse document state
  const DocumentElement = taleWeaver.getDocumentElementType();
  const documentElement = new DocumentElement();
  stateJSON.document.children.forEach(blockElementJSON => {
    const BlockElement = taleWeaver.getBlockElementType(blockElementJSON.type);
    if (!BlockElement) {
      throw new Error(`Unregistered block element type: ${blockElementJSON.type}.`);
    }
    const blockElement = new BlockElement();
    blockElementJSON.children.forEach(inlineElementJSON => {
      const InlineElement = taleWeaver.getInlineElementType(inlineElementJSON.type);
      if (!InlineElement) {
        throw new Error(`Unregistered inline element type: ${blockElementJSON.type}.`);
      }
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
