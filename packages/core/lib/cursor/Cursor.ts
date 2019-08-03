import Editor from '../Editor';
import CursorUpdatedEvent from '../events/CursorUpdatedEvent';

export default class Cursor {
    protected editor: Editor;
    protected anchor: number = 0;
    protected head: number = 0;
    protected leftLock: number | null = null;

    constructor(editor: Editor) {
        this.editor = editor;
    }

    set(anchor: number, head: number, leftLock: number | null) {
        this.anchor = anchor;
        this.head = head;
        this.leftLock = leftLock;
        this.editor.getDispatcher().dispatch(new CursorUpdatedEvent());
    }

    getAnchor() {
        return this.anchor;
    }

    getHead() {
        return this.head;
    }

    getLeftLock() {
        return this.leftLock;
    }
}
