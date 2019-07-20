import ModelUpdatedEvent from '../dispatch/events/ModelUpdatedEvent';
import RenderUpdatedEvent from '../dispatch/events/RenderUpdatedEvent';
import Editor from '../Editor';
import DocRenderNode from './DocRenderNode';
import ModelRenderer from './ModelRenderer';
import { AnyRenderNode } from './RenderNode';

function findModelByNodeID(modelID: string, node: AnyRenderNode): AnyRenderNode | null {
  if (node.getID() === modelID) {
    return node;
  }
  const childNodes = node.getChildNodes();
  for (let n = 0, nn = childNodes.length; n < nn; n++) {
    const foundNode = findModelByNodeID(modelID, childNodes[n]);
    if (foundNode) {
      return foundNode;
    }
  }
  return null;
}

export default class RenderEngine {
  protected editor: Editor;
  protected doc: DocRenderNode;

  constructor(editor: Editor) {
    this.editor = editor;
    this.doc = new DocRenderNode(editor);
    editor.getDispatcher().on(ModelUpdatedEvent, this.handleModelUpdatedEvent);
  }

  getDoc() {
    return this.doc;
  }

  protected handleModelUpdatedEvent(event: ModelUpdatedEvent) {
    const updatedModelNode = event.getUpdatedNode();
    const node = this.findNodeByModelID(updatedModelNode.getID());
    const renderer = new ModelRenderer(this.editor, updatedModelNode);
    const updatedNode = renderer.getRootNode();
    node.onUpdated(updatedNode);
    this.editor.getDispatcher().dispatch(new RenderUpdatedEvent(node));
  }

  protected findNodeByModelID(modelID: string) {
    return findModelByNodeID(modelID, this.doc)!;
  }
}
