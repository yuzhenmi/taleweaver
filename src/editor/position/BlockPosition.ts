import DocumentPosition from './DocumentPosition';
import BlockElement from '../element/BlockElement';

export default class BlockPosition {
  private documentPosition: DocumentPosition;
  private blockElement: BlockElement;
  private position: number;

  constructor(documentPosition: DocumentPosition, blockElement: BlockElement, position: number) {
    this.documentPosition = documentPosition;
    this.blockElement = blockElement;
    this.position = position;
  }

  getDocumentPosition(): DocumentPosition {
    return this.documentPosition;
  }

  getBlockElement(): BlockElement {
    return this.blockElement;
  }

  getPosition(): number {
    return this.position;
  }
}
