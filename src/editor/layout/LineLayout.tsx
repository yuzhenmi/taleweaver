import BoxLayout from './BoxLayout';

export default class LineLayout {
  private width: number;
  private boxes: BoxLayout[];

  constructor(width: number, boxes: BoxLayout[]) {
    this.width = width;
    this.boxes = boxes;
  }

  getSize(): number {
    let size = 0;
    this.boxes.forEach(box => {
      size += box.getSize();
    });
    return size;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return Math.max(...this.boxes.map(box => box.getHeight()));
  }

  getBoxes(): BoxLayout[] {
    return this.boxes;
  }
}
