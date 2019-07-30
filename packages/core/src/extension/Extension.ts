import Editor from '../Editor';

export default abstract class Extension {
    protected editor?: Editor;

    $onRegistered(editor: Editor) {
        this.editor = editor;
        if (this.onRegistered) {
            this.onRegistered();
        }
    }

    onRegistered?(): void;

    onMounted?(): void;

    getEditor(): Editor {
        if (!this.editor) {
            throw new Error('Extension has not yet been registered.');
        }
        return this.editor;
    }
}
