import Box from './Box';
import LineBox from './LineBox';
import ViewportBoundingRect from './ViewportBoundingRect';

type Child = LineBox;

export default abstract class BlockBox extends Box {
  protected children: Child[];

  constructor() {
    super(0, 680, 0);
    this.children = [];
  }

  abstract getType(): string;

  insertChild(child: Child, offset: number) {
    const childHeight = child.getHeight();
    this.height = this.height + childHeight;
    this.children.splice(offset, 0, child);
    this.selectableSize += child.getSelectableSize();
  }

  getChildren(): Child[] {
    return this.children;
  }

  abstract cutAt(offset: number): BlockBox;

  abstract resolveViewportPositionToSelectableOffset(x: number, y: number): number;

  abstract resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[];
}
