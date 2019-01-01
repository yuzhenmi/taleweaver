import BoxLayout from './BoxLayout';

export default class LineLayout {
  private width: number;
  private boxLayouts: BoxLayout[];
  private size: number;

  constructor(width: number, boxLayouts: BoxLayout[]) {
    this.width = width;
    this.boxLayouts = boxLayouts;

    // Determine size
    this.size = 0;
    this.boxLayouts.forEach(boxLayout => {
      this.size += boxLayout.getSize();
    });
  }

  getSize(): number {
    return this.size;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return Math.max(...this.boxLayouts.map(boxLayout => boxLayout.getHeight()));
  }

  getBoxLayouts(): BoxLayout[] {
    return this.boxLayouts;
  }

  getBoxLayoutAt(position: number): BoxLayout | null {
    let cumulatedSize = 0;
    for (let n = 0, nn = this.boxLayouts.length; n < nn; n++) {
      cumulatedSize += this.boxLayouts[n].getSize();
      if (cumulatedSize > position) {
        return this.boxLayouts[n];
      }
    }
    return null;
  }
}
