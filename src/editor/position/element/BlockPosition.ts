import DocumentPosition from '../DocumentPosition';
import Block from '../../element/block/Block';

export default class BlockPosition {
  private documentPosition: DocumentPosition;
  private block: Block;
  private position: number;

  constructor(documentPosition: DocumentPosition, block: Block, position: number) {
    this.documentPosition = documentPosition;
    this.block = block;
    this.position = position;
  }

  getDocumentPosition(): DocumentPosition {
    return this.documentPosition;
  }

  getBlock(): Block {
    return this.block;
  }

  getPosition(): number {
    return this.position;
  }
}
