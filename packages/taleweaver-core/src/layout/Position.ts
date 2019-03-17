import LayoutNode from './LayoutNode';
import AtomicBox from './AtomicBox';
import InlineBox from './InlineBox';
import LineBox from './LineBox';

type BuildChild = (parent: Position) => Position;

export default class Position {
  protected layoutNode: LayoutNode;
  protected selectableOffset: number;
  protected parent: Position | null;
  protected level: number;
  protected child: Position | null;

  constructor(layoutNode: LayoutNode, selectableOffset: number, parent?: Position, buildChild?: BuildChild) {
    this.layoutNode = layoutNode;
    this.selectableOffset = selectableOffset;
    this.parent = parent || null;
    this.level = parent ? parent.getLevel() + 1 : 0;
    this.child = buildChild ? buildChild(this) : null;
  }

  getLayoutNode(): LayoutNode {
    return this.layoutNode;
  }

  getSelectableOffset(): number {
    return this.selectableOffset;
  }

  getLevel(): number {
    return this.level;
  }

  getParent(): Position | null {
    return this.parent;
  }

  getChild(): Position | null {
    return this.child;
  }

  getAtomicBoxLevel(): Position {
    return this.child ? this.child.getAtomicBoxLevel() : this;
  }

  getLineBoxLevel(): Position {
    if (this.layoutNode instanceof LineBox) {
      return this;
    }
    if (
      this.layoutNode instanceof AtomicBox ||
      this.layoutNode instanceof InlineBox
    ) {
      const parent = this.getParent();
      if (!parent) {
        throw new Error(`No parent.`);
      }
      return parent.getLineBoxLevel();
    }
    const child = this.getChild();
    if (!child) {
      throw new Error(`No child.`);
    }
    return child.getLineBoxLevel();
  }
}
