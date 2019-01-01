import BlockPosition from './BlockPosition';
import Inline from '../element/inline/Inline';

export default class InlinePosition {
  private blockPosition: BlockPosition;
  private inline: Inline;
  private position: number;

  constructor(blockPosition: BlockPosition, inline: Inline, position: number) {
    this.blockPosition = blockPosition;
    this.inline = inline;
    this.position = position;
  }

  getBlockPosition(): BlockPosition {
    return this.blockPosition;
  }

  getInline(): Inline {
    return this.inline;
  }

  getPosition(): number {
    return this.position;
  }
}
