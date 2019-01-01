import Document from '../../element/Document';
import DocumentPosition from '../DocumentPosition';
import BlockPosition from '../BlockPosition';
import InlinePosition from '../InlinePosition';

export default function resolveElementPosition(document: Document, position: number): InlinePosition | null {
  const documentPosition = new DocumentPosition(document, position);
  const block = document.getBlockAt(documentPosition.getPosition());
  if (!block) {
    return null;
  }
  const blockPosition = new BlockPosition(documentPosition, block, position - block.getPositionInDocument());
  const inline = block.getInlineAt(blockPosition.getPosition());
  if (!inline) {
    return null;
  }
  const inlinePosition = new InlinePosition(blockPosition, inline, position - block.getPositionInDocument() - inline.getPositionInBlock());
  return inlinePosition;
}
