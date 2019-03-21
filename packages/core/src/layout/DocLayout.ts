import PageLayout from './PageLayout';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';
import LayoutNode from './LayoutNode';

type Child = PageLayout;

export default class DocLayout extends LayoutNode {
  protected children: Child[];

  constructor() {
    super(0);
    this.children = [];
  }

  getSelectableSize(): number {
    return this.selectableSize;
  }

  insertChild(child: Child, offset: number) {
    this.children.splice(offset, 0, child);
    child.setParent(this);
    this.selectableSize += child.getSelectableSize();
  }

  getChildren(): Child[] {
    return this.children;
  }

  resolvePosition(selectableOffset: number): Position {
    const position = new Position(this, selectableOffset, undefined, (parent: Position) => {
      let cumulatedSelectableOffset = 0;
      for (let n = 0, nn = this.children.length; n < nn; n++) {
        const child = this.children[n];
        const childSelectableSize = child.getSelectableSize();
        if (cumulatedSelectableOffset + childSelectableSize > selectableOffset) {
          const childPosition = child.resolvePosition(parent, selectableOffset - cumulatedSelectableOffset);
          return childPosition;
        }
        cumulatedSelectableOffset += childSelectableSize;
      }
      throw new Error(`Selectable offset ${selectableOffset} cannot be resolved to position.`);
    });
    return position;
  }

  resolveViewportPositionToSelectableOffset(pageOffset: number, x: number, y: number): number {
    if (pageOffset >= this.children.length) {
      throw new Error(`Page offset ${pageOffset} is out of range.`);
    }
    let selectableOffset = 0;
    for (let n = 0; n < pageOffset; n++) {
      selectableOffset += this.children[n].getSelectableSize();
    }
    return selectableOffset + this.children[pageOffset].resolveViewportPositionToSelectableOffset(x, y);
  }

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[][] {
    const viewportBoundingRects: ViewportBoundingRect[][] = [];
    this.children.forEach(() => {
      viewportBoundingRects.push([]);
    });
    let selectableOffset = 0;
    for (let n = 0, nn = this.children.length; n < nn && selectableOffset <= to; n++) {
      const child = this.children[n];
      const minChildOffset = 0;
      const maxChildOffset = child.getSelectableSize();
      const childFrom = Math.max(from - selectableOffset, minChildOffset);
      const childTo = Math.min(to - selectableOffset, maxChildOffset);
      if (childFrom <= maxChildOffset && childTo >= minChildOffset) {
        const childViewportBoundingRects = child.resolveSelectableOffsetRangeToViewportBoundingRects(childFrom, childTo);
        childViewportBoundingRects.forEach(childViewportBoundingRect => {
          viewportBoundingRects[n].push({
            left: childViewportBoundingRect.left,
            right: childViewportBoundingRect.right,
            top: childViewportBoundingRect.top,
            bottom: childViewportBoundingRect.bottom,
            width: childViewportBoundingRect.width,
            height: childViewportBoundingRect.height,
          });
        });
      }
      selectableOffset += child.getSelectableSize();
    }
    return viewportBoundingRects;
  }
}
