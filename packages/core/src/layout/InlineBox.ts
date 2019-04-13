import InlineRenderNode from '../render/InlineRenderNode';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';
import Box from './Box';
import LineFlowBox from './LineFlowBox';
import AtomicBox from './AtomicBox';

type Parent = LineFlowBox;
type Child = AtomicBox;

export default abstract class InlineBox extends Box {
  protected version: number;
  protected width?: number;
  protected widthWithoutTrailingWhitespace?: number;
  protected height?: number;
  protected selectableSize?: number;
  protected parent?: Parent;
  protected children: Child[];

  constructor(renderNodeID: string) {
    super(renderNodeID);
    this.version = 0;
    this.children = [];
  }

  abstract getType(): string;

  setVersion(version: number) {
    this.version = version;
  }

  getVersion(): number {
    return this.version;
  }

  getWidth(): number {
    if (this.width === undefined) {
      let width = 0;
      this.getChildren().forEach(child => {
        width += child.getWidth();
      });
      this.width = width;
    }
    return this.width;
  }

  getWidthWithoutTrailingWhitespace(): number {
    if (this.widthWithoutTrailingWhitespace === undefined) {
      const lastChild = this.children[this.children.length - 1];
      this.widthWithoutTrailingWhitespace = this.getWidth() - lastChild.getWidth() + lastChild.getWidthWithoutTrailingWhitespace();
    }
    return this.widthWithoutTrailingWhitespace;
  }

  getHeight(): number {
    if (this.height === undefined) {
      let height = 0;
      this.getChildren().forEach(child => {
        const childHeight = child.getHeight();
        if (childHeight > height) {
          height = childHeight;
        }
      });
      this.height = height;
    }
    return this.height;
  }

  setParent(parent: Parent) {
    this.parent = parent;
  }

  getParent(): Parent {
    if (!this.parent) {
      throw new Error(`Inline box has no parent set.`);
    }
    return this.parent;
  }

  insertChild(child: Child, offset: number) {
    this.children.splice(offset, 0, child);
    child.setParent(this);
    this.width = undefined;
    this.height = undefined;
    this.widthWithoutTrailingWhitespace = undefined;
  }

  deleteChild(child: Child) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    this.children.splice(childOffset, 1);
    this.width = undefined;
    this.height = undefined;
    this.widthWithoutTrailingWhitespace = undefined;
  }

  getChildren(): Child[] {
    return this.children;
  }

  getPreviousSibling(): InlineBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Inline box is not found in parent.`);
    }
    if (offset > 0) {
      return siblings[offset - 1];
    }
    const parentPreviousSibling = this.getParent().getPreviousSibling();
    if (!parentPreviousSibling) {
      return null;
    }
    const parentPreviousSiblingChildren = parentPreviousSibling.getChildren();
    return parentPreviousSiblingChildren[parentPreviousSiblingChildren.length - 1];
  }

  getNextSibling(): InlineBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Inline box is not found in parent.`);
    }
    if (offset < siblings.length - 1) {
      return siblings[offset + 1];
    }
    const parentNextSibling = this.getParent().getNextSibling();
    if (!parentNextSibling) {
      return null;
    }
    const parentNextSiblingChildren = parentNextSibling.getChildren();
    return parentNextSiblingChildren[0];
  }

  getSelectableSize(): number {
    if (this.selectableSize === undefined) {
      let selectableSize = 0;
      this.children.forEach(child => {
        selectableSize += child.getSelectableSize();
      });
      this.selectableSize = selectableSize;
    }
    return this.selectableSize;
  }

  onRenderUpdated(renderNode: InlineRenderNode) {
    this.selectableSize = undefined;
    this.width = undefined;
    this.height = undefined;
    this.widthWithoutTrailingWhitespace = undefined;
  }

  resolvePosition(parentPosition: Position, selectableOffset: number): Position {
    const position = new Position(this, selectableOffset, parentPosition, (parent: Position) => {
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

  abstract splitAt(offset: number): InlineBox;

  abstract join(inlineBox: InlineBox): void;

  resolveViewportPositionToSelectableOffset(x: number): number {
    let selectableOffset = 0;
    let cumulatedWidth = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childWidth = child.getWidth();
      if (x >= cumulatedWidth && x <= cumulatedWidth + childWidth) {
        selectableOffset += child.resolveViewportPositionToSelectableOffset(x - cumulatedWidth);
        break;
      }
      selectableOffset += child.getSelectableSize();
      cumulatedWidth += childWidth;
    }
    return selectableOffset;
  }

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[] {
    const viewportBoundingRects: ViewportBoundingRect[] = [];
    let selectableOffset = 0;
    let cumulatedWidth = 0;
    for (let n = 0, nn = this.children.length; n < nn && selectableOffset <= to; n++) {
      const child = this.children[n];
      const childWidth = child.getWidth();
      const minChildOffset = 0;
      const maxChildOffset = child.getSelectableSize();
      const childFrom = Math.max(from - selectableOffset, minChildOffset);
      const childTo = Math.min(to - selectableOffset, maxChildOffset);
      if (childFrom <= maxChildOffset && childTo >= minChildOffset) {
        const childViewportBoundingRects = child.resolveSelectableOffsetRangeToViewportBoundingRects(childFrom, childTo);
        childViewportBoundingRects.forEach(childViewportBoundingRect => {
          viewportBoundingRects.push({
            left: cumulatedWidth + childViewportBoundingRect.left,
            right: this.getWidth() - cumulatedWidth - childWidth + childViewportBoundingRect.right,
            top: 0,
            bottom: 0,
            width: childViewportBoundingRect.width,
            height: this.getHeight(),
          });
        });
      }
      selectableOffset += child.getSelectableSize();
      cumulatedWidth += childWidth;
    }
    return viewportBoundingRects;
  }
}
