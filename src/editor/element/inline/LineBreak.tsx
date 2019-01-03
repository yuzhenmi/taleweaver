import React from 'react';
import BoxLayout from '../../layout/BoxLayout';
import TextStyle from '../../layout/TextStyle';
import measureText from '../../layout/util/measureText';
import viewRegistry from '../../view/util/viewRegistry';
import Block from '../block/Block';
import Inline from './Inline';
import LineLayout from '../../layout/LineLayout';

const textStyle = new TextStyle('sans-serif', 16, 400);

export default class LineBreak implements Inline {
  private block: Block;

  constructor(block: Block) {
    this.block = block;
  }

  getType(): string {
    return 'LineBreak';
  }

  getSize(): number {
    return 1;
  }

  getBlock(): Block {
    return this.block;
  }

  buildBoxLayouts(lineLayout: LineLayout): BoxLayout[] {
    return [new LineBreakLayout(lineLayout)];
  }
}

export class LineBreakLayout implements BoxLayout {
  private lineLayout: LineLayout;
  private width: number;
  private height: number;

  constructor(lineLayout: LineLayout) {
    this.lineLayout = lineLayout;
    ({ width: this.width, height: this.height} = measureText(' ', textStyle));
  }

  getType(): string {
    return 'LineBreak';
  }

  getSize(): number {
    return 1;
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
    if (from === 0 && to === 1) {
      return this.width;
    }
    return 0;
  }

  getContent(): string {
    return ' ';
  }
}

type LineBreakViewProps = {
  boxLayout: LineBreakLayout;
};
export class LineBreakView extends React.Component<LineBreakViewProps> {
  render() {
    const { boxLayout } = this.props;
    return boxLayout.getContent();
  }
}
viewRegistry.registerBoxView('LineBreak', LineBreakView);
