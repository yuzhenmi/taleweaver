import Editor from '../Editor';
import generateID from '../utils/generateID';
import BlockBox from './BlockLayoutNode';
import InlineNode from './InlineLayoutNode';
import LayoutNode, { LayoutPosition } from './LayoutNode';
import LayoutRect from './LayoutRect';
import mergeLayoutRects from './utils/mergeLayoutRects';

type ParentNode = BlockBox;
type ChildNode = InlineNode;

export default class LineLayoutNode extends LayoutNode<ParentNode, ChildNode> {
  protected size?: number;
  protected height?: number;

  constructor(editor: Editor) {
    super(editor, generateID());
  }

  isRoot() {
    return false;
  }

  isLeaf() {
    return false;
  }

  getType() {
    return 'Line';
  }

  getSize() {
    if (this.size === undefined) {
      this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 0);
    }
    return this.size;
  }

  getWidth() {
    return this.getParent()!.getWidth();
  }

  getHeight() {
    if (this.height === undefined) {
      this.height = this.getChildNodes().reduce(
        (height, childNode) => height + childNode.getPaddingTop() + childNode.getHeight() + childNode.getPaddingBottom(),
        0,
      );
    }
    return this.height;
  }

  clearCache() {
    this.size = undefined;
    this.height = undefined;
  }

  onRenderUpdated() {
    this.clearCache();
  }

  splitAt(offset: number) {
    const newNode = new LineLayoutNode(this.editor);
    while (this.getChildNodes().length > offset) {
      const childNode = this.getChildNodes()[offset];
      this.removeChild(childNode);
      newNode.appendChild(childNode);
    }
    this.clearCache();
    return newNode;
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

  convertCoordinatesToOffset(x: number) {
    let offset = 0;
    let cumulatedWidth = 0;
    const childNodes = this.getChildNodes();
    for (let n = 0, nn = childNodes.length; n < nn; n++) {
      const childNode = childNodes[n];
      const childWidth = childNode.getWidth();
      if (x >= cumulatedWidth && x <= cumulatedWidth + childWidth) {
        offset += childNode.convertCoordinatesToOffset(x - cumulatedWidth);
        break;
      }
      offset += childNode.getSize();
      cumulatedWidth += childWidth;
    }
    if (offset === this.getSize()) {
      return offset - 1;
    }
    return offset;
  }

  resolveLayoutRects(from: number, to: number) {
    const layoutRects: LayoutRect[] = [];
    let offset = 0;
    let cumulatedWidth = 0;
    const childNodes = this.getChildNodes();
    for (let n = 0, nn = childNodes.length; n < nn && offset <= to; n++) {
      const childNode = childNodes[n];
      const childWidth = childNode.getWidth();
      const minChildOffset = 0;
      const maxChildOffset = childNode.getSize();
      const childFrom = Math.max(from - offset, minChildOffset);
      const childTo = Math.min(to - offset, maxChildOffset);
      if (childFrom <= maxChildOffset && childTo >= minChildOffset && !(childFrom === childTo && childTo === maxChildOffset)) {
        const childLayoutRects = childNode.resolveLayoutRects(childFrom, childTo);
        childLayoutRects.forEach(childLayoutRect => {
          const width = childLayoutRect.width;
          const height = childLayoutRect.height;
          const left = cumulatedWidth + childLayoutRect.left;
          const right = this.getWidth() - cumulatedWidth - childLayoutRect.right;
          const top = childLayoutRect.top;
          const bottom = childLayoutRect.bottom;
          layoutRects.push({
            width,
            height,
            left,
            right,
            top,
            bottom,
            paddingTop: childLayoutRect.paddingTop,
            paddingBottom: childLayoutRect.paddingBottom,
            paddingLeft: 0,
            paddingRight: 0,
          });
        });
      }
      offset += childNode.getSize();
      cumulatedWidth += childWidth;
    }
    mergeLayoutRects(layoutRects);
    return layoutRects;
  }
}
