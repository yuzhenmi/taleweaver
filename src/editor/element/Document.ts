import Element from './Element';
import Block from './block/Block';
import PageLayout from '../layout/PageLayout';
import BlockLayout from '../layout/BlockLayout';

export default class Document implements Element {
  private blocks: Block[];
  private size: number;
  private pageLayouts: PageLayout[];

  constructor(onCreateBlocks: (document: Document) => Block[]) {
    // Create blocks
    this.blocks = onCreateBlocks(this);

    // Determine size
    this.size = 0;
    this.blocks.forEach(block => {
      this.size += block.getSize();
    });

    // Build page layouts
    this.pageLayouts = [];
    const pageWidth = 600;
    const pageHeight = 776;
    let blockIndex = 0;
    while (blockIndex < this.blocks.length) {
      const pageLayout = new PageLayout(this, (pageLayout, availableHeight) => {
        if (blockIndex === this.blocks.length) {
          return null;
        }
        const blockLayout = this.blocks[blockIndex].buildBlockLayout(pageLayout);
        if (blockLayout.getHeight() > availableHeight) {
          return null;
        }
        blockIndex++;
        return blockLayout;
      });
      if (pageLayout.getBlockLayouts().length > 0) {
        this.pageLayouts.push(pageLayout);
      }
    }
  }

  getBlocks(): Block[] {
    return this.blocks;
  }

  getSize(): number {
    return this.size;
  }

  getPageLayouts(): PageLayout[] {
    return this.pageLayouts;
  }

  getBlockAt(position: number): Block | null {
    let cumulatedSize = 0;
    for (let n = 0, nn = this.blocks.length; n < nn; n++) {
      cumulatedSize += this.blocks[n].getSize();
      if (cumulatedSize > position) {
        return this.blocks[n];
      }
    }
    return null;
  }

  getPageLayoutAt(position: number): PageLayout | null {
    let cumulatedSize = 0;
    for (let n = 0, nn = this.pageLayouts.length; n < nn; n++) {
      cumulatedSize += this.pageLayouts[n].getSize();
      if (cumulatedSize > position) {
        return this.pageLayouts[n];
      }
    }
    return null;
  }
}
