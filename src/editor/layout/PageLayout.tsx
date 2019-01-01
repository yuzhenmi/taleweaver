import BlockLayout from './BlockLayout';

export default class PageLayout {
  private width: number;
  private height: number;
  private blockLayouts: BlockLayout[];
  private size: number;

  constructor(width: number, height: number, blockLayouts: BlockLayout[]) {
    this.width = width;
    this.height = height;
    this.blockLayouts = blockLayouts;

    // Determine size
    this.size = 0;
    this.blockLayouts.forEach(block => {
      this.size += block.getSize();
    });
  }

  getSize(): number {
    return this.size;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getBlockLayouts(): BlockLayout[] {
    return this.blockLayouts;
  }

  getBlockLayoutAt(position: number): BlockLayout | null {
    let cumulatedSize = 0;
    for (let n = 0, nn = this.blockLayouts.length; n < nn; n++) {
      cumulatedSize += this.blockLayouts[n].getSize();
      if (cumulatedSize > position) {
        return this.blockLayouts[n];
      }
    }
    return null;
  }
}
