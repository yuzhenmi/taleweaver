import BlockPosition from './BlockPosition';
import InlineElement from '../element/InlineElement';

export default class InlinePosition {
  private blockPosition: BlockPosition;
  private inlineElement: InlineElement;
  private position: number;

  constructor(blockPosition: BlockPosition, inlineElement: InlineElement, position: number) {
    this.blockPosition = blockPosition;
    this.inlineElement = inlineElement;
    this.position = position;
  }

  getBlockPosition(): BlockPosition {
    return this.blockPosition;
  }

  getInlineElement(): InlineElement {
    return this.inlineElement;
  }

  getPosition(): number {
    return this.position;
  }
}
