import Document from '../../element/Document';
import DocumentPosition from '../DocumentPosition';
import BlockPosition from '../element/BlockPosition';
import InlinePosition from '../element/InlinePosition';
import Block from '../../element/block/Block';
import Inline from '../../element/inline/Inline';

function getBlockPositionInDocument(document: Document, block: Block): number {
  const blocks = document.getBlocks();
  let cumulatedSize = 0;
  for (let n = 0, nn = blocks.length; n < nn; n++) {
    if (blocks[n] === block) {
      return cumulatedSize;
    }
    cumulatedSize += blocks[n].getSize();
  }
  return -1;
}

function getInlinePositionInBlock(block: Block, inline: Inline): number {
  const inlines = block.getInlines();
  let cumulatedSize = 0;
  for (let n = 0, nn = inlines.length; n < nn; n++) {
    if (inlines[n] === inline) {
      return cumulatedSize;
    }
    cumulatedSize += inlines[n].getSize();
  }
  return -1;
}

export default function resolveElementPosition(document: Document, position: number): InlinePosition | null {
  // Build document position
  const documentPosition = new DocumentPosition(document, position);

  // Build block position
  const block = document.getBlockAt(documentPosition.getPosition());
  if (!block) {
    return null;
  }
  const blockPositionInDocument = getBlockPositionInDocument(document, block);
  if (blockPositionInDocument < 0) {
    return null;
  }
  const blockPosition = new BlockPosition(documentPosition, block, position - blockPositionInDocument);

  // Build inline position
  const inline = block.getInlineAt(blockPosition.getPosition());
  if (!inline) {
    return null;
  }
  const inlinePositionInBlock = getInlinePositionInBlock(block, inline);
  if (inlinePositionInBlock < 0) {
    return null;
  }
  const inlinePosition = new InlinePosition(blockPosition, inline, position - blockPositionInDocument - inlinePositionInBlock);
  return inlinePosition;
}
