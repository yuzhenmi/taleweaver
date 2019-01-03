import React from 'react';
import Inline from './Inline';
import Block from '../block/Block';
import BoxLayout from '../../layout/BoxLayout';
import TextStyle from '../../layout/TextStyle';
import measureText from '../../layout/util/measureText';
import viewRegistry from '../../view/util/viewRegistry';
import LineLayout from '../../layout/LineLayout';

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

  constructor(block: Block, content: string) {
    this.block = block;
    this.content = content;

    // Determine size
    this.size = this.content.length;
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

  buildBoxLayouts(lineLayout: LineLayout): BoxLayout[] {
    const boxLayouts: BoxLayout[] = [];
    let startIndex = 0;
    let n = 0;
    for (let nn = this.content.length; n < nn; n++) {
      const char = this.content[n];
      if (BREAKABLE_CHARS.indexOf(char) >= 0) {
        boxLayouts.push(new TextLayout(
          lineLayout,
          this.content.substring(startIndex, n + 1),
          this,
        ));
        startIndex = n + 1;
      }
    }
    if (startIndex < n) {
      boxLayouts.push(new TextLayout(
        lineLayout,
        this.content.substring(startIndex, n),
        this,
      ));
    }
    return boxLayouts;
  }
}

export class TextLayout implements BoxLayout {
  private lineLayout: LineLayout;
  private content: string;
  private textElement: Text;
  private width: number;
  private height: number;

  constructor(lineLayout: LineLayout, content: string, textElement: Text) {
    this.lineLayout = lineLayout;
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

  getLineLayout(): LineLayout {
    return this.lineLayout;
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
