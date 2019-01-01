import { ReactNode } from 'react';
import InlineElement from './InlineElement';
import BlockElement from './BlockElement';
import Box from '../layout/Box';
import TextStyle from '../layout/TextStyle';
import measureText from '../layout/util/measureText';

const textStyle = new TextStyle('sans-serif', 16, 400);

const BREAKABLE_CHARS = [
  ' ',
  '-',
];

class TextBox implements Box {
  private text: string;
  private textElement: Text;
  private width: number;
  private height: number;

  constructor(text: string, textElement: Text) {
    this.text = text;
    this.textElement = textElement;
    ({ width: this.width, height: this.height} = measureText(text, textStyle));
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  render(): ReactNode {
    return this.text;
  }
}

export default class Text implements InlineElement {
  private blockElement: BlockElement;
  private text: string;

  constructor(blockElement: BlockElement, text: string) {
    this.blockElement = blockElement;
    this.text = text;
  }

  getSize(): number {
    return this.text.length;
  }

  getBlockElement(): BlockElement {
    return this.blockElement;
  }

  getPositionInBlock(): number {
    const inlineElements = this.blockElement.getInlineElements();
    let cumulatedSize = 0;
    for (let n = 0, nn = inlineElements.length; n < nn; n++) {
      if (inlineElements[n] === this) {
        return cumulatedSize;
      }
      cumulatedSize += inlineElements[n].getSize();
    }
    return -1;
  }

  getBoxes(lineWidth: number): Box[] {
    const boxes: Box[] = [];
    let startIndex = 0;
    let n = 0;
    for (let nn = this.text.length; n < nn; n++) {
      const char = this.text[n];
      if (BREAKABLE_CHARS.indexOf(char) >= 0) {
        boxes.push(new TextBox(
          this.text.substring(startIndex, n + 1),
          this,
        ));
        startIndex = n + 1;
      }
    }
    if (startIndex < n) {
      boxes.push(new TextBox(
        this.text.substring(startIndex, n),
        this,
      ));
    }
    return boxes;
  }
}
