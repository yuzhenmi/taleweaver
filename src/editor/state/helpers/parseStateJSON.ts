import TaleWeaver from '../../TaleWeaver';
import State from '../State';
import Cursor from '../../cursor/Cursor';

type WordJSON = {
  type: string;
  text: string;
}
type BlockJSON = {
  type: string;
  children: WordJSON[];
}
type DocJSON = {
  children: BlockJSON[];
}
type CursorJSON = {
  anchor: number;
  head: number;
}
type StateJSON = {
  document: DocJSON;
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
  const Doc = registry.getDocClass();
  const doc = new Doc();
  stateJSON.document.children.forEach(blockJSON => {
    const Block = registry.getBlockClass(blockJSON.type);
    const block = new Block();
    blockJSON.children.forEach(wordJSON => {
      const Word = registry.getWordClass(wordJSON.type);
      const word = new Word();
      word.setText(wordJSON.text);
      block.appendChild(word);
    });
    doc.appendChild(block);
  });
  state.setDoc(doc);

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
