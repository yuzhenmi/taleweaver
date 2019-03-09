import Config from '../Config';
import RenderNode from './RenderNode';
import DocRenderNode from './DocRenderNode';
import Doc from '../model/Doc';
import BranchNode from '../model/BranchNode';
import Doc from '../model/Doc';
import BlockRenderNode from './BlockRenderNode';
import InlineRenderNode from './InlineRenderNode';

interface ChildInfo {
  child: RenderNode;
  offset: number;
}

type ChildrenMap = Map<string, ChildInfo>;

export default class RenderEngine {
  protected config: Config;
  protected renderDoc: DocRenderNode;

  constructor(config: Config, doc: Doc) {
    this.config = config;
    this.renderDoc = new DocRenderNode(doc.getSelectableSize());
    // TODO: Subscribe to changes from doc
    this.render(doc);
  }

  getDocRenderNode(): DocRenderNode {
    return this.renderDoc;
  }

  protected render(doc: Doc) {
    this.renderDoc(doc, this.renderDoc);
  }

  protected renderDoc(node: Doc, renderNode: DocRenderNode) {
    const children = node.getChildren();
    const renderChildren = renderNode.getChildren();
    const renderChildrenMap: ChildrenMap = new Map()
    renderChildren.forEach((child, offset) => {
      renderChildrenMap.set(child.getID(), { child, offset });
    });
    let renderChildOffset = 0;
    children.forEach(child => {
      let renderChild: BlockRenderNode;
      if (renderChildrenMap.has(child.getID())) {
        const renderChildInfo = renderChildrenMap.get(child.getID())!;
        renderChild = renderChildInfo.child as BlockRenderNode;
        while (renderChildOffset < renderChildInfo.offset) {
          const toDelete = renderChildren[renderChildOffset];
          if (toDelete instanceof BlockRenderNode) {
            renderNode.deleteChild(toDelete);
          } else {
            throw new Error(`Render engine error, expecting BlockRenderNode as child of DocRenderNode.`);
          }
          renderChildOffset += 1;
        }
        renderChildOffset += 1;
      } else {
        const RenderNodeClass = this.config.getRenderNodeClass(child.getType());
        renderChild = new RenderNodeClass(parent, child) as BlockRenderNode;
        renderNode.insertChild(renderChild, renderChildOffset);
        renderChildOffset += 1;
      }
      this.renderBranchNode(child as BranchNode, renderChild);
    });
  }

  protected renderBranchNode(node: BranchNode, renderNode: BlockRenderNode) {
    const children = node.getChildren();
    const renderChildren = renderNode.getChildren();
    const renderChildrenMap: ChildrenMap = new Map()
    renderChildren.forEach((child, offset) => {
      renderChildrenMap.set(child.getID(), { child, offset });
    });
    let renderChildOffset = 0;
    children.forEach(child => {
      let renderChild: InlineRenderNode;
      if (renderChildrenMap.has(child.getID())) {
        const renderChildInfo = renderChildrenMap.get(child.getID())!;
        renderChild = renderChildInfo.child as InlineRenderNode;
        while (renderChildOffset < renderChildInfo.offset) {
          const toDelete = renderChildren[renderChildOffset];
          if (toDelete instanceof InlineRenderNode) {
            renderNode.deleteChild(toDelete);
          } else {
            throw new Error(`Render engine error, expecting InlineRenderNode as child of BlockRenderNode.`);
          }
          renderChildOffset += 1;
        }
        renderChildOffset += 1;
      } else {
        const RenderNodeClass = this.config.getRenderNodeClass(child.getType());
        renderChild = new RenderNodeClass(parent, child) as InlineRenderNode;
        if (!(renderChild instanceof InlineRenderNode)) {
          throw new Error(`Render engine error, expecting InlineRenderNode as child of BlockRenderNode.`);
        }
        renderNode.insertChild(renderChild, renderChildOffset);
        renderChildOffset += 1;
      }
    });
  }
}
