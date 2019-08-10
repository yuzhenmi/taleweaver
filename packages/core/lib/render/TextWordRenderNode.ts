import Editor from '../Editor';
import TextModelNode from '../model/TextModelNode';
import AtomicRenderNode from './AtomicRenderNode';
import TextStyle from './TextStyle';
import { Word } from './utils/breakTextToWords';

export default class TextWordRenderNode extends AtomicRenderNode {
    protected content: string;
    protected breakable: boolean;
    protected textStyle: TextStyle;

    constructor(editor: Editor, modelNode: TextModelNode, wordIndex: number, textStyle: TextStyle, word: Word) {
        super(editor, `${modelNode.getID()}-${wordIndex}`);
        this.content = word.text;
        this.breakable = word.breakable;
        this.textStyle = textStyle;
    }

    getType() {
        return 'TextWord';
    }

    getSize() {
        return this.content.length;
    }

    clearCache() { }

    getContent() {
        return this.content;
    }

    getBreakable() {
        return this.breakable;
    }

    getTextStyle() {
        return this.textStyle;
    }

    onUpdated(updatedNode: this) {
        this.content = updatedNode.getContent();
        this.breakable = updatedNode.getBreakable();
        this.textStyle = updatedNode.getTextStyle();
        super.onUpdated(updatedNode);
    }
}
