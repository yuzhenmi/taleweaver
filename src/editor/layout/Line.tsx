import React, { ReactNode } from 'react';
import Box from './Box';

export default class Line {
  private width: number;
  private boxes: Box[];

  constructor(width: number, boxes: Box[]) {
    this.width = width;
    this.boxes = boxes;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return Math.max(...this.boxes.map(box => box.getHeight()));
  }

  getBoxes(): Box[] {
    return this.boxes;
  }

  render(): ReactNode {
    return (
      <div className="tw--line">
        {this.boxes.map(box => box.render())}
      </div>
    );
  }
}
