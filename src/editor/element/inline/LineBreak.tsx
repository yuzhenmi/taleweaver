import React from 'react';
import BoxLayout from '../../layout/BoxLayout';
import TextStyle from '../../layout/TextStyle';
import measureText from '../../layout/util/measureText';
import viewRegistry from '../../view/util/viewRegistry';
import Block from '../block/Block';
import Inline from './Inline';

const textStyle = new TextStyle('sans-serif', 16, 400);

export default class LineBreak implements Inline {
  private block: Block;
  private boxLayouts: BoxLayout[];

  constructor(block: Block) {
    this.block = block;

    // Build box layouts
    this.boxLayouts = [];
    this.boxLayouts.push(new LineBreakLayout());
  }

  getType(): string {
    return 'Text';
  }

  getSize(): number {
    return 1;
  }

  getBlock(): Block {
    return this.block;
  }

  getBoxLayouts(): BoxLayout[] {
    return this.boxLayouts;
  }
}

export class LineBreakLayout implements BoxLayout {
  private width: number;
  private height: number;

  constructor() {
    ({ width: this.width, height: this.height} = measureText(' ', textStyle));
  }

  getType(): string {
    return 'LineBreak';
  }

  getSize(): number {
    return 1;
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
