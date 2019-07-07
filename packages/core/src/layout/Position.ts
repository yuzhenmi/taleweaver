import LayoutNode from './LayoutNode';
import AtomicBox from './AtomicBox';
import InlineBox from './InlineBox';
import LineFlowBox from './LineFlowBox';

type BuildChild = (parent: Position) => Position;

export default class Position {
  protected layoutNode: LayoutNode;
  protected offset: number;
  protected parent: Position | null;
  protected level: number;
  protected child: Position | null;

  constructor(layoutNode: LayoutNode, offset: number, parent?: Position, buildChild?: BuildChild) {
    this.layoutNode = layoutNode;
    this.offset = offset;
    this.parent = parent || null;
    this.level = parent ? parent.getLevel() + 1 : 0;
    this.child = buildChild ? buildChild(this) : null;
  }

  getLayoutNode(): LayoutNode {
    return this.layoutNode;
  }

  getOffset(): number {
    return this.offset;
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

  getLineFlowBoxLevel(): Position {
    if (this.layoutNode instanceof LineFlowBox) {
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
      return parent.getLineFlowBoxLevel();
    }
    const child = this.getChild();
    if (!child) {
      throw new Error(`No child.`);
    }
    return child.getLineFlowBoxLevel();
  }
}
