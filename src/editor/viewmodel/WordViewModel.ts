import TaleWeaver from '../TaleWeaver';
import Inline from '../model/Inline';
import BlockViewModel from './BlockViewModel';

export interface Segment {
  inline: Inline;
  from: number;
  to: number;
}

abstract class WordViewModel {
  protected taleWeaver: TaleWeaver;
  protected blockViewModel: BlockViewModel;
  protected segments: Segment[];

  constructor(taleWeaver: TaleWeaver, blockViewModel: BlockViewModel, segments: Segment[]) {
    this.taleWeaver = taleWeaver;
    this.blockViewModel = blockViewModel;
    this.segments = segments;
  }

  abstract getType(): string;

  abstract getSize(): number;

  getSegments(): Segment[] {
    return this.segments;
  }
}

export default WordViewModel;
