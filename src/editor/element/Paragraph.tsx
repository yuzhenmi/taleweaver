import React, { ReactNode } from 'react';
import BlockElement from './BlockElement';
import InlineElement from './InlineElement';
import Document from './Document';
import Block from '../layout/Block';
import Line from '../layout/Line';
import Box from '../layout/Box';
import buildLinesFromBoxes from '../layout/util/buildLinesFromBoxes';

class ParagraphBlock implements Block {
  private width: number;
  private lines: Line[];

  constructor(width: number, boxes: Box[]) {
    this.width = width;
    this.lines = buildLinesFromBoxes(width, boxes);
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    let height = 0;
    this.lines.forEach(line => {
      height += line.getHeight();
    });
    return height;
  }

  getLines(): Line[] {
    return this.lines;
  }

  render(): ReactNode {
    return (
      <div className="tw--paragraph">
        {this.lines.map(line => line.render())}
      </div>
    );
  }
}

export default class Paragraph implements BlockElement {
  private document: Document;
  private inlineElements: InlineElement[];

  constructor(document: Document) {
    this.document = document;
    this.inlineElements = [];
  }

  getSize(): number {
    let size = 0;
    this.inlineElements.forEach(inlineElement => {
      size += inlineElement.getSize();
    });
    return size;
  }

  getDocument(): Document {
    return this.document;
  }

  appendInlineElement(inlineElement: InlineElement) {
    this.inlineElements.push(inlineElement);
  }

  getInlineElements(): InlineElement[] {
    return this.inlineElements;
  }

  getPositionInDocument(): number {
    const blockElements = this.document.getBlockElements();
    let cumulatedSize = 0;
    for (let n = 0, nn = blockElements.length; n < nn; n++) {
      if (blockElements[n] === this) {
        return cumulatedSize;
      }
      cumulatedSize += blockElements[n].getSize();
    }
    return -1;
  }

  getInlineElementAt(position: number): InlineElement | null {
    let cumulatedSize = 0;
    for (let n = 0, nn = this.inlineElements.length; n < nn; n++) {
      cumulatedSize += this.inlineElements[n].getSize();
      if (cumulatedSize > position) {
        return this.inlineElements[n];
      }
    }
    return null;
  }

  getBlock(): Block {
    const boxes: Box[] = [];
    this.inlineElements.forEach(inlineElement => {
      boxes.push(...inlineElement.getBoxes(600));
    });
    const block = new ParagraphBlock(600, boxes);
    return block;
  }
}
