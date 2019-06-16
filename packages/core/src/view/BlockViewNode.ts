import BranchNode from '../tree/BranchNode';
import BlockBox from '../layout/BlockBox';
import ViewNode from './ViewNode';
import PageViewNode from './PageViewNode';
import LineViewNode from './LineViewNode';

export type Parent = PageViewNode;
export type Child = LineViewNode;

export default abstract class BlockViewNode extends ViewNode implements BranchNode {
  protected parent: Parent | null = null;
  protected children: Child[] = [];

  setParent(parent: Parent | null) {
    this.parent = parent;
  }

  getParent() {
    if (!this.parent) {
      throw new Error(`No parent has been set.`);
    }
    return this.parent;
  }

  abstract insertChild(child: LineViewNode, offset: number): void;

  abstract deleteChild(child: Child): void;

  abstract getChildren(): Child[];

  abstract onLayoutUpdated(layoutNode: BlockBox): void;

  resolveSelectableOffsetToNodeOffset(offset: number) {
    let cumulatedOffset = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      if (cumulatedOffset + child.getSelectableSize() > offset) {
        return child.resolveSelectableOffsetToNodeOffset(offset - cumulatedOffset);
      }
      cumulatedOffset += child.getSelectableSize();
    }
    throw new Error(`Selectable offset ${offset} is out of range.`);
  }
}
