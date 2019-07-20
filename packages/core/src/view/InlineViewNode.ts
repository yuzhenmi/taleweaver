import InlineBox from '../layout/InlineLayoutNode';
import LeafNode from '../tree/LeafNode';
import LineViewNode from './LineViewNode';
import ViewNode from './ViewNode';

export type Parent = LineViewNode;

export default abstract class InlineViewNode extends ViewNode implements LeafNode {
  protected parent: Parent | null = null;

  setParent(parent: Parent | null) {
    this.parent = parent;
  }

  getParent() {
    if (!this.parent) {
      throw new Error(`No parent has been set.`);
    }
    return this.parent;
  }

  abstract onLayoutUpdated(layoutNode: InlineBox): void;
}
