import Config from '../Config';
import RenderNode from './RenderNode';
import RenderDoc from './RenderDoc';
import Doc from '../model/Doc';
import BranchNode from '../model/BranchNode';
import RootNode from '../model/RootNode';
import RenderBlock from './RenderBlock';
import RenderInline from './RenderInline';

interface ChildInfo {
  child: RenderNode;
  offset: number;
}

type ChildrenMap = Map<string, ChildInfo>;

export default class Renderer {
  protected config: Config;
  protected renderDoc: RenderDoc;

  constructor(config: Config, renderDoc: RenderDoc) {
    this.config = config;
    this.renderDoc = renderDoc;
  }

  render(doc: Doc) {
    this.renderRootNode(doc, this.renderDoc);
  }

  protected renderRootNode(node: RootNode, renderNode: RenderDoc) {
    const children = node.getChildren();
    const renderChildren = renderNode.getChildren();
    const renderChildrenMap: ChildrenMap = new Map()
    renderChildren.forEach((child, offset) => {
      renderChildrenMap.set(child.getID(), { child, offset });
    });
    let renderChildOffset = 0;
    children.forEach(child => {
      let renderChild: RenderBlock;
      if (renderChildrenMap.has(child.getID())) {
        const renderChildInfo = renderChildrenMap.get(child.getID())!;
        renderChild = renderChildInfo.child as RenderBlock;
        while (renderChildOffset < renderChildInfo.offset) {
          const toDelete = renderChildren[renderChildOffset];
          if (toDelete instanceof RenderBlock) {
            renderNode.deleteChild(toDelete);
          } else {
            throw new Error(`Renderer error, expecting RenderBlock as child of RenderDoc.`);
          }
          renderChildOffset += 1;
        }
        renderChildOffset += 1;
      } else {
        const RenderNodeClass = this.config.getRenderNodeClass(child.getType());
        renderChild = new RenderNodeClass(parent, child.getID(), child.getSize(), child.getSelectableSize()) as RenderBlock;
        renderNode.insertChild(renderChild, renderChildOffset);
        renderChildOffset += 1;
      }
      this.renderBranchNode(child, renderChild);
    });
  }

  protected renderBranchNode(node: BranchNode, renderNode: RenderBlock) {
    const children = node.getChildren();
    const renderChildren = renderNode.getChildren();
    const renderChildrenMap: ChildrenMap = new Map()
    renderChildren.forEach((child, offset) => {
      renderChildrenMap.set(child.getID(), { child, offset });
    });
    let renderChildOffset = 0;
    children.forEach(child => {
      let renderChild: RenderInline;
      if (renderChildrenMap.has(child.getID())) {
        const renderChildInfo = renderChildrenMap.get(child.getID())!;
        renderChild = renderChildInfo.child as RenderInline;
        while (renderChildOffset < renderChildInfo.offset) {
          const toDelete = renderChildren[renderChildOffset];
          if (toDelete instanceof RenderInline) {
            renderNode.deleteChild(toDelete);
          } else {
            throw new Error(`Renderer error, expecting RenderInline as child of RenderBlock.`);
          }
          renderChildOffset += 1;
        }
        renderChildOffset += 1;
      } else {
        const RenderNodeClass = this.config.getRenderNodeClass(child.getType());
        renderChild = new RenderNodeClass(parent, child.getID(), child.getSize(), child.getSelectableSize()) as RenderInline;
        if (!(renderChild instanceof RenderInline)) {
          throw new Error(`Renderer error, expecting RenderInline as child of RenderBlock.`);
        }
        renderNode.insertChild(renderChild, renderChildOffset);
        renderChildOffset += 1;
      }
    });
  }
}
