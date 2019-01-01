import Element from './Element';
import BlockElement from './BlockElement';
import Page from '../layout/Page';
import buildPagesFromBlocks from '../layout/util/buildPagesFromBlocks';

export default class Document implements Element {
  private blockElements: BlockElement[];

  constructor() {
    this.blockElements = [];
  }

  getSize(): number {
    let size = 0;
    this.blockElements.forEach(blockElement => {
      size += blockElement.getSize();
    });
    return size;
  }

  getBlockElements(): BlockElement[] {
    return this.blockElements;
  }

  appendBlockElement(blockElement: BlockElement) {
    this.blockElements.push(blockElement);
  }

  getBlockElementAt(position: number): BlockElement | null {
    let cumulatedSize = 0;
    for (let n = 0, nn = this.blockElements.length; n < nn; n++) {
      cumulatedSize += this.blockElements[n].getSize();
      if (cumulatedSize > position) {
        return this.blockElements[n];
      }
    }
    return null;
  }

  getPages(): Page[] {
    const blocks = this.blockElements.map(blockElement => blockElement.getBlock());
    return buildPagesFromBlocks(600, 776, blocks);
  }
}
