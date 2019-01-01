import Element from './Element';
import Block from './block/Block';
import PageLayout from '../layout/PageLayout';
import buildPageLayoutsFromBlockLayouts from '../layout/util/buildPagesFromBlocks';

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
    const blockLayouts = this.blocks.map(block => block.getBlockLayout());
    this.pageLayouts = buildPageLayoutsFromBlockLayouts(600, 776, blockLayouts);
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
}
