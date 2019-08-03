import Editor from '../Editor';
import Extension from './Extension';

export default class ExtensionProvider {
    protected editor: Editor;
    protected extensions: Extension[];

    constructor(editor: Editor) {
        this.editor = editor;
        this.extensions = [];
    }

    registerExtension(extension: Extension) {
        this.extensions.push(extension);
        extension.$onRegistered(this.editor);
    }

    onMounted() {
        this.extensions.forEach(extension => {
            if (extension.onMounted) {
                extension.onMounted();
            }
        });
    }
}
