import Editor from '../Editor';
import Cursor from './Cursor';

export default class CursorService {
    protected editor: Editor;
    protected cursor?: Cursor;

    constructor(editor: Editor, hasCursor = true) {
        this.editor = editor;
        if (hasCursor) {
            this.cursor = new Cursor(editor);
        }
    }

    hasCursor() {
        return !!this.cursor;
    }

    set(anchor: number, head: number, leftLock: number | null) {
        if (!this.cursor) {
            console.warn('Attempted to set cursor position but there is no cursor.');
            return;
        }
        this.cursor.set(anchor, head, leftLock);
    }

    getAnchor() {
        if (!this.cursor) {
            return -1;
        }
        return this.cursor.getAnchor();
    }

    getHead() {
        if (!this.cursor) {
            return -1;
        }
        return this.cursor.getHead();
    }

    getLeftLock() {
        if (!this.cursor) {
            return -1;
        }
        return this.cursor.getLeftLock();
    }
}
