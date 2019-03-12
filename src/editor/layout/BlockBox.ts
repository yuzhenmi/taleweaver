import Box from './Box';
import LineBox from './LineBox';

type Child = LineBox;

export default abstract class BlockBox extends Box {
  protected children: Child[];

  constructor(selectableSize: number) {
    super(selectableSize, 0, 0);
    this.children = [];
  }

  insertChild(child: Child, offset: number) {
    const childWidth = child.getWidth();
    const childHeight = child.getHeight();
    this.width += childWidth;
    this.height = Math.max(this.height, childHeight);
    this.children.splice(offset, 0, child);
  }

  getChildren(): Child[] {
    return this.children;
  }
}
