import { measureText } from '../util/TextMeasurer';
import TextStyle from '../TextStyle';
import Token from './Token';
import BlockElement from '../../model/BlockElement';
import InlineElement from '../../model/InlineElement';

const textStyle = new TextStyle('sans-serif', 16, 400);

export default class TextToken implements Token {
  private text: string;
  private posteriorDelimiter: string;
  private blockElement: BlockElement;
  private inlineElement: InlineElement;
  private width: number;
  private height: number;

  constructor(text: string, posteriorDelimiter: string, blockElement: BlockElement, inlineElement: InlineElement) {
    this.blockElement = blockElement;
    this.inlineElement = inlineElement;
    this.text = text;
    this.posteriorDelimiter = posteriorDelimiter;
    ({ width: this.width, height: this.height} = measureText(text + posteriorDelimiter, textStyle));
  }

  getBlockElement(): BlockElement {
    return this.blockElement;
  }

  getInlineElement(): InlineElement {
    return this.inlineElement;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  render(): string {
    return this.text + this.posteriorDelimiter;
  }
}
