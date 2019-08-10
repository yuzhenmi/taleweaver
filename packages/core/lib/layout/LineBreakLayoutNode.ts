import Editor from '../Editor';
import LineBreakRenderNode from '../render/LineBreakRenderNode';
import InlineNode from './InlineLayoutNode';

export default class LineBreakLayoutNode extends InlineNode {
    protected renderNode: LineBreakRenderNode;

    constructor(editor: Editor, renderNode: LineBreakRenderNode) {
        super(editor, renderNode.getID());
        this.renderNode = renderNode;
    }

    getType() {
        return 'LineBreak';
    }

    getPaddingTop() {
        return 3;
    }

    getPaddingBottom() {
        return 6;
    }

    splitAt(offset: number): LineBreakLayoutNode {
        throw new Error('Cannot split line break inline box.');
    }

    join(node: LineBreakLayoutNode) {
        throw new Error('Cannot join line break inline boxes.');
    }
}
