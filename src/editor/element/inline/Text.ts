import React from 'react';
import Inline from './Inline';
import Block from '../block/Block';
import BoxLayout from '../../layout/BoxLayout';
import TextStyle from '../../layout/TextStyle';
import measureText from '../../layout/util/measureText';
import viewRegistry from '../../view/util/viewRegistry';

const textStyle = new TextStyle('sans-serif', 16, 400);

const BREAKABLE_CHARS = [
  ' ',
  '\t',
  '-',
];

export default class Text implements Inline {
  private block: Block;
  private content: string;
  private size: number;
  private boxLayouts: BoxLayout[];

  constructor(block: Block, content: string) {
    this.block = block;
    this.content = content;

    // Determine size
    this.size = this.content.length;

    // Build box layouts
    this.boxLayouts = [];
    let startIndex = 0;
    let n = 0;
    for (let nn = this.content.length; n < nn; n++) {
      const char = this.content[n];
      if (BREAKABLE_CHARS.indexOf(char) >= 0) {
        this.boxLayouts.push(new TextLayout(
          this.content.substring(startIndex, n + 1),
          this,
        ));
        startIndex = n + 1;
      }
    }
    if (startIndex < n) {
      this.boxLayouts.push(new TextLayout(
        this.content.substring(startIndex, n),
        this,
      ));
    }
  }

  getType(): string {
    return 'Text';
  }

  getSize(): number {
    return this.size;
  }

  getBlock(): Block {
    return this.block;
  }

  getBoxLayouts(): BoxLayout[] {
    return this.boxLayouts;
  }

  getPositionInBlock(): number {
    const inlines = this.block.getInlines();
    let cumulatedSize = 0;
    for (let n = 0, nn = inlines.length; n < nn; n++) {
      if (inlines[n] === this) {
        return cumulatedSize;
      }
      cumulatedSize += inlines[n].getSize();
    }
    return -1;
  }
}

export class TextLayout implements BoxLayout {
  private content: string;
  private textElement: Text;
  private width: number;
  private height: number;

  constructor(content: string, textElement: Text) {
    this.content = content;
    this.textElement = textElement;
    ({ width: this.width, height: this.height} = measureText(content, textStyle));
  }

  getType(): string {
    return 'Text';
  }

  getSize(): number {
    return this.content.length;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getWidthBetween(from: number, to: number): number {
    return measureText(this.content.substring(from, to), textStyle).width;
  }

  getContent(): string {
    return this.content;
  }
}

type TextViewProps = {
  boxLayout: TextLayout;
};
export class TextView extends React.Component<TextViewProps> {
  render() {
    const { boxLayout } = this.props;
    return boxLayout.getContent();
  }
}
viewRegistry.registerBoxView('Text', TextView);
