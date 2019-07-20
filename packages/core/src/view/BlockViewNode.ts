import BlockBox from '../layout/BlockLayoutNode';
import BranchNode from '../tree/BranchNode';
import LineViewNode from './LineViewNode';
import PageViewNode from './PageViewNode';
import ViewNode from './ViewNode';

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
}
