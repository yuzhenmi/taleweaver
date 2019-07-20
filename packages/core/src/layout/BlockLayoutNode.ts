import LayoutNode, { LayoutPosition } from './LayoutNode';
import LayoutRect from './LayoutRect';
import LineNode from './LineLayoutNode';
import PageNode from './PageLayoutNode';

type ParentNode = PageNode;
type ChildNode = LineNode;

export default abstract class BlockLayoutNode extends LayoutNode<ParentNode, ChildNode> {
  abstract getPaddingTop(): number;
  abstract getPaddingBottom(): number;
  abstract splitAt(offset: number): BlockLayoutNode;
  abstract join(blockBox: BlockLayoutNode): void;

  protected size?: number;
  protected height?: number;

  isRoot() {
    return false;
  }

  isLeaf() {
    return false;
  }

  getWidth() {
    return this.getParent()!.getInnerWidth();
  }

  getHeight() {
    if (this.height === undefined) {
      this.height = this.getChildNodes().reduce(
        (height, childNode) => height + childNode.getHeight(),
        this.getPaddingTop() + this.getPaddingBottom(),
      );
    }
    return this.height;
  }

  getSize() {
    if (this.size === undefined) {
      this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 0);
    }
    return this.size;
  }

  resolvePosition(offset: number, depth: number) {
    let cumulatedOffset = 0;
    const childNodes = this.getChildNodes();
    for (let n = 0, nn = childNodes.length; n < nn; n++) {
      const childNode = childNodes[n];
      const childSize = childNode.getSize();
      if (cumulatedOffset + childSize > offset) {
        const position: LayoutPosition = {
          node: this,
          depth,
          offset,
        };
        const childPosition = childNode.resolvePosition(offset - cumulatedOffset, depth + 1);
        position.child = childPosition;
        childPosition.parent = position;
        return position;
      }
      cumulatedOffset += childSize;
    }
    throw new Error(`Offset ${offset} is out of range.`);
  }

  resolveViewportPositionToSelectableOffset(x: number, y: number) {
    let selectableOffset = 0;
    let cumulatedHeight = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childHeight = child.getHeight();
      if (y >= cumulatedHeight && y <= cumulatedHeight + childHeight) {
        selectableOffset += child.resolveViewportPositionToSelectableOffset(x);
        break;
      }
      selectableOffset += child.getSelectableSize();
      cumulatedHeight += childHeight;
    }
    return selectableOffset;
  }

  resolveLayoutRects(from: number, to: number) {
    const layoutRects: LayoutRect[] = [];
    let offset = 0;
    let cumulatedHeight = 0;
    const childNodes = this.getChildNodes();
    for (let n = 0, nn = childNodes.length; n < nn && offset <= to; n++) {
      const childNode = childNodes[n];
      const childHeight = childNode.getHeight();
      const minChildOffset = 0;
      const maxChildOffset = childNode.getSize();
      const childFrom = Math.max(from - offset, minChildOffset);
      const childTo = Math.min(to - offset, maxChildOffset);
      if (childFrom <= maxChildOffset && childTo >= minChildOffset) {
        const childLayoutRects = childNode.resolveLayoutRects(childFrom, childTo);
        childLayoutRects.forEach(childLayoutRect => {
          const width = childLayoutRect.width;
          const height = childLayoutRect.height;
          const paddingTop = this.getPaddingTop();
          const paddingBottom = this.getPaddingBottom();
          const left = childLayoutRect.left;
          const right = childLayoutRect.right;
          const top = cumulatedHeight + paddingTop + childLayoutRect.top;
          const bottom = this.getHeight() - cumulatedHeight - childHeight - childLayoutRect.bottom - paddingBottom;
          layoutRects.push({
            width,
            height,
            left,
            right,
            top,
            bottom,
            paddingTop: childLayoutRect.paddingTop,
            paddingBottom: childLayoutRect.paddingBottom,
            paddingLeft: childLayoutRect.paddingLeft,
            paddingRight: childLayoutRect.paddingRight,
          });
        });
      }
      offset += childNode.getSize();
      cumulatedHeight += childHeight;
    }
    return layoutRects;
  }

  clearCache() {
    this.size = undefined;
    this.height = undefined;
  }
}
