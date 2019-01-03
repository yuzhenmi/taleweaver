import BoxLayout from './BoxLayout';
import BlockLayout from './BlockLayout';

export default class LineLayout {
  private blockLayout: BlockLayout;
  private width: number;
  private boxLayouts: BoxLayout[];
  private size: number;

  constructor(blockLayout: BlockLayout, buildBoxLayouts: (lineLayout: LineLayout, availableWidth: number) => BoxLayout[]) {
    this.blockLayout = blockLayout;
    this.width = blockLayout.getWidth();
    
    // Build box layouts
    this.boxLayouts = [];
    let availableWidth = this.width;
    while (availableWidth > 0) {
      const boxLayouts = buildBoxLayouts(this, availableWidth);
      if (boxLayouts.length === 0) {
        break;
      }
      for (let n = 0, nn = boxLayouts.length; n < nn; n++) {
        const boxLayout = boxLayouts[n];
        availableWidth -= boxLayout.getWidth();
        if (availableWidth < 0) {
          break;
        }
        this.boxLayouts.push(boxLayout);
      }
    }

    // Determine size
    this.size = 0;
    this.boxLayouts.forEach(boxLayout => {
      this.size += boxLayout.getSize();
    });
  }

  getSize(): number {
    return this.size;
  }

  getBlockLayout(): BlockLayout {
    return this.blockLayout;
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
