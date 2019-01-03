import BlockLayout from './BlockLayout';
import Document from '../element/Document';

export default class PageLayout {
  private document: Document;
  private width: number;
  private height: number;
  private blockLayouts: BlockLayout[];
  private size: number;

  constructor(document: Document, buildBlockLayout: (pageLayout: PageLayout, availableHeight: number) => BlockLayout | null) {
    this.document = document;
    this.width = 600;
    this.height = 776;

    // Build block layouts
    this.blockLayouts = [];
    let availableHeight = this.height;
    while (availableHeight > 0) {
      const blockLayout = buildBlockLayout(this, availableHeight);
      if (!blockLayout) {
        break;
      }
      availableHeight -= blockLayout.getHeight();
      if (availableHeight >= 0) {
        this.blockLayouts.push(blockLayout);
      }
    }

    // Determine size
    this.size = 0;
    this.blockLayouts.forEach(block => {
      this.size += block.getSize();
    });
  }

  getDocument(): Document {
    return this.document;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getSize(): number {
    return this.size;
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
