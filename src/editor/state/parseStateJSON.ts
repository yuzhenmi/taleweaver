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
  editorCursors: CursorJSON[];
  observerCursors: CursorJSON[];
}

export default function parseStateJSON(taleWeaver: TaleWeaver, stateJSON: StateJSON): State {
  const state = new State();
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
  stateJSON.editorCursors.forEach(editorCursorJSON => {
    const editorCursor = new Cursor();
    editorCursor.setAnchor(editorCursorJSON.anchor);
    editorCursor.setHead(editorCursorJSON.head);
    state.appendEditorCursor(editorCursor);
  });
  stateJSON.observerCursors.forEach(observerCursorJSON => {
    const observerCursor = new Cursor();
    observerCursor.setAnchor(observerCursorJSON.anchor);
    observerCursor.setHead(observerCursorJSON.head);
    state.appendObserverCursor(observerCursor);
  });
  return state;
}
