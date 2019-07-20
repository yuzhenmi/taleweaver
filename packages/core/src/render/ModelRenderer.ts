import Editor from '../Editor';
import { AnyModelNode } from '../model/ModelNode';
import { AnyRenderNode } from './RenderNode';

export default class ModelRenderer {
  protected editor: Editor;
  protected rootModelNode: AnyModelNode;
  protected rootNode?: AnyRenderNode;
  protected ran: boolean = false;

  constructor(editor: Editor, rootModelNode: AnyModelNode) {
    this.editor = editor;
    this.rootModelNode = rootModelNode;
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
