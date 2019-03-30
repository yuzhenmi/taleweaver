import BlockRenderNode from '../render/BlockRenderNode';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';
import Box from './Box';
import PageFlowBox from './PageFlowBox';
import LineFlowBox from './LineFlowBox';

type Parent = PageFlowBox;
type Child = LineFlowBox;

export default abstract class BlockBox extends Box {
  protected version: number;
  protected width: number;
  protected height?: number;
  protected selectableSize?: number;
  protected parent?: Parent;
  protected children: Child[];

  constructor(renderNodeID: string) {
    super(renderNodeID);
    this.version = 0;
    this.width = 0;
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
    return this.getParent().getInnerWidth();
  }

  getHeight(): number {
    if (this.height === undefined) {
      let height = 0;
      this.children.forEach(child => {
        height += child.getHeight();
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
      throw new Error('Block box has no parent set.');
    }
    return this.parent;
  }

  insertChild(child: Child, offset: number) {
    this.children.splice(offset, 0, child);
    child.setParent(this);
  }

  deleteChild(child: Child) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    this.children.splice(childOffset, 1);
  }

  getChildren(): Child[] {
    return this.children;
  }

  getPreviousSibling(): BlockBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Block box is not found in parent.`);
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

  getNextSibling(): BlockBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Block box is not found in parent.`);
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

  abstract onRenderUpdated(renderNode: BlockRenderNode): void;

  abstract cleaveAt(offset: number): BlockBox;

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

  abstract resolveViewportPositionToSelectableOffset(x: number, y: number): number;

  abstract resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[];
}
