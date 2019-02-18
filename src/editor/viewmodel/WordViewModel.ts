import TaleWeaver from '../TaleWeaver';
import Node from '../tree/Node';
import LeafNode from '../tree/LeafNode';
import TreePosition from '../tree/TreePosition';
import Inline from '../model/Inline';
import BlockViewModel from './BlockViewModel';

export type Parent = BlockViewModel;

export interface Segment {
  inline: Inline;
  from: number;
  to: number;
}

abstract class WordViewModel extends LeafNode {
  protected taleWeaver: TaleWeaver;
  protected segments: Segment[];
  protected parent: Parent;

  constructor(taleWeaver: TaleWeaver, segments: Segment[], parent: Parent) {
    super();
    this.taleWeaver = taleWeaver;
    this.segments = segments;
    this.parent = parent;
  }

  abstract getType(): string;

  abstract getSize(): number;

  getParent(): Parent {
    return this.parent;
  }

  getPreviousSibling(): Node | null {
    const siblings = this.parent.getChildren();
    let index = siblings.indexOf(this);
    if (index < 0) {
      throw new Error(`Model is corrupted, block not found in parent.`);
    }
    if (index === 0) {
      return null;
    }
    return siblings[index - 1];
  }

  getNextSibling(): Node | null {
    const siblings = this.parent.getChildren();
    let index = siblings.indexOf(this);
    if (index < 0) {
      throw new Error(`Model is corrupted, block not found in parent.`);
    }
    if (index === siblings.length - 1) {
      return null;
    }
    return siblings[index + 1];
  }

  parentAt(offset: number): TreePosition {
    if (offset < 0) {
      throw new Error(`Word view offset out of range: ${offset}.`);
    }
    if (offset > this.getSize() - 1) {
      throw new Error(`Word view offset out of range: ${offset}.`);
    }
    const parent = this.parent;
    const siblings = parent.getChildren();
    let cumulatedParentOffset = 1;
    for (let n = 0, nn = siblings.length; n < nn; n++) {
      const sibling = siblings[n];
      if (sibling === this) {
        return new TreePosition(parent, cumulatedParentOffset + offset);
      }
      cumulatedParentOffset += sibling.getSize();
    }
    throw new Error(`View model is corrupted, word view not found in parent.`);
  }

  getSegments(): Segment[] {
    return this.segments;
  }
}

export default WordViewModel;
