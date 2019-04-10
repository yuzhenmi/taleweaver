import BlockBox from '../layout/BlockBox';
import ViewNode from './ViewNode';
import LineViewNode from './LineViewNode';

export type Child = LineViewNode;

export default abstract class BlockViewNode extends ViewNode {
  protected children: Child[];

  constructor(id: string) {
    super(id);
    this.children = [];
  }

  abstract insertChild(child: LineViewNode, offset: number): void;

  abstract deleteChild(child: Child): void;

  abstract getChildren(): Child[];

  abstract onLayoutUpdated(layoutNode: BlockBox): void;

  resolveSelectableOffsetToNodeOffset(offset: number): [Node, number] {
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
