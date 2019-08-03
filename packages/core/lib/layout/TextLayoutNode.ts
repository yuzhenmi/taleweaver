import Editor from '../Editor';
import TextRenderNode from '../render/TextRenderNode';
import InlineNode from './InlineLayoutNode';

export default class TextLayoutNode extends InlineNode {
    protected renderNode: TextRenderNode;

    constructor(editor: Editor, renderNode: TextRenderNode) {
        super(editor, renderNode.getID());
        this.renderNode = renderNode;
    }

    getType() {
        return 'Text';
    }

    getPaddingTop() {
        return 0;
    }

    getPaddingBottom() {
        return 0;
    }

    splitAt(offset: number) {
        const newNode = new TextLayoutNode(this.editor, this.renderNode);
        while (this.getChildNodes().length > offset) {
            const childNode = this.getChildNodes()[offset];
            this.removeChild(childNode);
            newNode.appendChild(childNode);
        }
        this.clearCache();
        return newNode;
    }

    join(node: TextLayoutNode) {
        node.getChildNodes().forEach(childNode => {
            node.removeChild(childNode);
            this.appendChild(childNode);
        });
        this.clearCache();
    }

    getTextStyle() {
        return this.renderNode.getTextStyle();
    }
}
