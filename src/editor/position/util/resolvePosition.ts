import Document from '../../element/Document';
import DocumentPosition from '../DocumentPosition';
import BlockPosition from '../BlockPosition';
import InlinePosition from '../InlinePosition';

export default function resolvePosition(document: Document, position: number): InlinePosition | null {
  const documentPosition = new DocumentPosition(document, position);
  const blockElement = document.getBlockElementAt(documentPosition.getPosition());
  if (!blockElement) {
    return null;
  }
  const blockPosition = new BlockPosition(documentPosition, blockElement, position - blockElement.getPositionInDocument());
  const inlineElement = blockElement.getInlineElementAt(blockPosition.getPosition());
  if (!inlineElement) {
    return null;
  }
  const inlinePosition = new InlinePosition(blockPosition, inlineElement, position - blockElement.getPositionInDocument() - inlineElement.getPositionInBlock());
  return inlinePosition;
}
