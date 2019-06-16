import LeafNode from '../tree/LeafNode';
import InlineBox from '../layout/InlineBox';
import ViewNode from './ViewNode';
import LineViewNode from './LineViewNode';

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

  abstract resolveSelectionOffset(offset: number): number;
}
