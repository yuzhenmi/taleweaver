import AtomicRenderNode from '../render/AtomicRenderNode';
import ViewportBoundingRect from './ViewportBoundingRect';
import Position from './Position';
import Box from './Box';
import InlineBox from './InlineBox';

type Parent = InlineBox;

export default abstract class AtomicBox extends Box {
  protected widthWithoutTrailingWhitespace?: number;
  protected parent: Parent | null = null;
  protected breakable: boolean;

  constructor(renderNodeID: string) {
    super(renderNodeID);
    this.breakable = true;
  }

  setVersion(version: number) {
    if (this.version < version) {
      this.version = version;
      if (this.parent) {
        this.parent.setVersion(version);
      }
    }
  }

  isBreakable(): boolean {
    return this.breakable;
  }

  abstract getWidthWithoutTrailingWhitespace(): number;

  setParent(parent: Parent | null) {
    this.parent = parent;
  }

  getParent(): Parent {
    if (!this.parent) {
      throw new Error(`Atomic box has no parent set.`);
    }
    return this.parent;
  }

  getPreviousSibling(): AtomicBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Atomic box is not found in parent.`);
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

  getNextSibling(): AtomicBox | null {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Atomic box is not found in parent.`);
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

  abstract getSelectableSize(): number;

  abstract onRenderUpdated(renderNode: AtomicRenderNode): void;

  resolvePosition(parentPosition: Position, selectableOffset: number): Position {
    const position = new Position(this, selectableOffset, parentPosition);
    return position;
  }

  abstract splitAtWidth(width: number): AtomicBox;

  abstract join(atomicBox: AtomicBox): void;

  abstract resolveViewportPositionToSelectableOffset(x: number): number;

  abstract resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[];

  protected clearCache() {
    super.clearCache();
    this.widthWithoutTrailingWhitespace = undefined;
  }
}
