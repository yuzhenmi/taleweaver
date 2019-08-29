import Editor from '../Editor';
import ParagraphRenderNode from '../render/ParagraphRenderNode';
import BlockNode from './BlockLayoutNode';

export default class ParagraphLayoutNode extends BlockNode {
    protected renderNode: ParagraphRenderNode;

    constructor(editor: Editor, renderNode: ParagraphRenderNode) {
        super(editor, renderNode.getID());
        this.renderNode = renderNode;
    }

    getPaddingTop() {
        return 0;
    }

    getPaddingBottom() {
        return 12;
    }

    getType(): string {
        return 'Paragraph';
    }

    splitAt(offset: number) {
        const newNode = new ParagraphLayoutNode(this.editor, this.renderNode);
        while (this.getChildNodes().length > offset) {
            const childNode = this.getChildNodes()[offset];
            this.removeChild(childNode);
            newNode.appendChild(childNode);
        }
        this.clearCache();
        return newNode;
    }

    join(paragraphNode: ParagraphLayoutNode) {
        const childNodes = paragraphNode.getChildNodes().slice();
        childNodes.forEach(childNode => {
            paragraphNode.removeChild(childNode);
            this.appendChild(childNode);
        });
        this.clearCache();
        paragraphNode.clearCache();
    }

    onUpdated(updatedNode: this) {
        super.onUpdated(updatedNode);
    }
}
