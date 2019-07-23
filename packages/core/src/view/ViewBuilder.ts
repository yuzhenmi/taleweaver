import Editor from '../Editor';
import { AnyLayoutNode } from '../layout/LayoutNode';
import { AnyViewNode } from './ViewNode';

export default class ViewBuilder {
  protected editor: Editor;
  protected rootLayoutNode: AnyLayoutNode;
  protected rootNode?: AnyViewNode;
  protected ran: boolean = false;

  constructor(editor: Editor, rootLayoutNode: AnyLayoutNode) {
    this.editor = editor;
    this.rootLayoutNode = rootLayoutNode;
  }

  getRootNode() {
    if (!this.ran) {
      this.render();
    }
    return this.rootNode!;
  }

  protected render() {
    this.ran = true;
    this.rootNode = this.buildNode(this.rootLayoutNode);
  }

  protected buildNode(layoutNode: AnyLayoutNode) {
    const nodeConfig = this.editor.getConfig().getNodeConfig();
    const MatchingViewNode = nodeConfig.getViewNodeClass(layoutNode.getType());
    const node = new MatchingViewNode(this.editor, layoutNode);
    if (!layoutNode.isLeaf()) {
      layoutNode.getChildNodes().forEach(childModelNode => {
        const childNode = this.buildNode(childModelNode);
        node.appendChild(childNode);
      });
    }
    return node;
  }
}
