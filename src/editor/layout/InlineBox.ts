import Box from './Box';
import AtomicBox from './AtomicBox';

type Child = AtomicBox;

export default abstract class InlineBox extends Box {
  protected children: Child[];

  constructor() {
    super(0, 0, 0);
    this.children = [];
  }

  abstract getType(): string;

  insertChild(child: Child, offset: number) {
    const childWidth = child.getWidth();
    const childHeight = child.getHeight();
    this.width += childWidth;
    this.height = Math.max(this.height, childHeight);
    this.children.splice(offset, 0, child);
    this.selectableSize += child.getSelectableSize();
  }

  getChildren(): Child[] {
    return this.children;
  }

  abstract cutAt(offset: number): InlineBox;
}
