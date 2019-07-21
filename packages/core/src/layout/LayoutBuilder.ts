import Editor from '../Editor';
import { AnyLayoutNode } from '../layout/LayoutNode';
import { AnyRenderNode } from '../render/RenderNode';

export default class LayoutBuilder {
    protected editor: Editor;
    protected rootRenderNode: AnyRenderNode;
    protected rootNode?: AnyLayoutNode;
    protected ran: boolean = false;

    constructor(editor: Editor, rootRenderNode: AnyRenderNode) {
        this.editor = editor;
        this.rootRenderNode = rootRenderNode;
    }

    getRootNode() {
        if (!this.ran) {
            this.render();
        }
        return this.rootNode!;
    }

    protected render() {
        this.ran = true;
        this.rootNode = this.buildNode(this.rootModelNode);
    }

    protected buildNode(modelNode: AnyModelNode) {
        const nodeConfig = this.editor.getConfig().getNodeConfig();
        const MatchingRenderNode = nodeConfig.getRenderNodeClass(modelNode.getType());
        const node = new MatchingRenderNode(this.editor, modelNode.getID());
        if (!modelNode.isLeaf()) {
            modelNode.getChildNodes().forEach(childModelNode => {
                const childNode = this.buildNode(childModelNode);
                node.appendChild(childNode);
            });
        }
        return node;
    }
}
