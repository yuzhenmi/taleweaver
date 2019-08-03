import Editor from '../Editor';
import ParagraphModelNode from '../model/ParagraphModelNode';
import BlockRenderNode from './BlockRenderNode';

export default class ParagraphRenderNode extends BlockRenderNode {

    constructor(editor: Editor, modelNode: ParagraphModelNode) {
        super(editor, modelNode.getID());
    }

    getType() {
        return 'Paragraph';
    }
}
