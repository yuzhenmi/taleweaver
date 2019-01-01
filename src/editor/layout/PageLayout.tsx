import BlockLayout from './BlockLayout';

export default class PageLayout {
  private width: number;
  private height: number;
  private blocks: BlockLayout[];

  constructor(width: number, height: number, blocks: BlockLayout[]) {
    this.width = width;
    this.height = height;
    this.blocks = blocks;
  }

  getSize(): number {
    let size = 0;
    this.blocks.forEach(block => {
      size += block.getSize();
    });
    return size;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getBlocks(): BlockLayout[] {
    return this.blocks;
  }
}
