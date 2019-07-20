import Editor from '../Editor';
import BlockNode from './BlockRenderNode';
import RenderNode, { RenderPosition } from './RenderNode';

export type ChildNode = BlockNode;

export default class DocRenderNode extends RenderNode<never, ChildNode> {
  protected size?: number;
  protected modelSize?: number;

  constructor(editor: Editor) {
    super(editor, 'Doc');
  }

  isRoot() {
    return true;
  }

  isLeaf() {
    return false;
  }

  getType() {
    return 'Doc';
  }

  getSize() {
    if (this.size === undefined) {
      this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 0);
    }
    return this.size!;
  }

  getModelSize() {
    if (this.modelSize === undefined) {
      this.modelSize = this.getChildNodes().reduce((size, childNode) => size + childNode.getModelSize(), 2);
    }
    return this.modelSize!;
  }

  clearCache() {
    this.size = undefined;
    this.modelSize = undefined;
  }

  convertOffsetToModelOffset(offset: number): number {
    let cumulatedSize = 0;
    let cumulatedModelSize = 1;
    const childNodes = this.getChildNodes();
    for (let n = 0, nn = childNodes.length; n < nn; n++) {
      const childNode = childNodes[n];
      const childSize = childNode.getSize();
      if (cumulatedSize + childSize > offset) {
        return cumulatedModelSize + childNode.convertOffsetToModelOffset(offset - cumulatedSize);
      }
      cumulatedSize += childSize;
      cumulatedModelSize += childNode.getModelSize();
    }
    throw new Error(`Offset ${offset} is out of range.`);
  }

  resolvePosition(offset: number): RenderPosition {
    let cumulatedOffset = 0;
    const childNodes = this.getChildNodes();
    for (let n = 0, nn = childNodes.length; n < nn; n++) {
      const childNode = childNodes[n];
      const childSize = childNode.getSize();
      if (cumulatedOffset + childSize > offset) {
        const position: RenderPosition = {
          node: this,
          depth: 0,
          offset,
        };
        const childPosition = childNode.resolvePosition(offset - cumulatedOffset, 1);
        position.child = childPosition;
        childPosition.parent = position;
        return position;
      }
      cumulatedOffset += childSize;
    }
    throw new Error(`Offset ${offset} is out of range.`);
  }
}
