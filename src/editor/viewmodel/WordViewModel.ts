import TaleWeaver from '../TaleWeaver';
import Inline from '../model/Inline';
import BlockViewModel from './BlockViewModel';

export type Parent = BlockViewModel;

export interface Segment {
  inline: Inline;
  from: number;
  to: number;
}

abstract class WordViewModel {
  protected taleWeaver: TaleWeaver;
  protected segments: Segment[];
  protected parent: Parent;

  constructor(taleWeaver: TaleWeaver, segments: Segment[], parent: Parent) {
    this.taleWeaver = taleWeaver;
    this.segments = segments;
    this.parent = parent;
  }

  abstract getType(): string;

  abstract getSize(): number;

  getParent(): Parent {
    return this.parent;
  }

  getSegments(): Segment[] {
    return this.segments;
  }
}

export default WordViewModel;
