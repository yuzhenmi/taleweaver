import Document from '../../element/Document';
import DocumentPosition from '../DocumentPosition';
import PageLayoutPosition from '../layout/PageLayoutPosition';
import BlockLayoutPosition from '../layout/BlockLayoutPosition';
import LineLayoutPosition from '../layout/LineLayoutPosition';
import BoxLayoutPosition from '../layout/BoxLayoutPosition';
import PageLayout from '../../layout/PageLayout';
import BlockLayout from '../../layout/BlockLayout';
import LineLayout from '../../layout/LineLayout';
import BoxLayout from '../../layout/BoxLayout';

function getPageLayoutPositionInDocument(document: Document, pageLayout: PageLayout): number {
  const pageLayouts = document.getPageLayouts();
  let cumulatedSize = 0;
  for (let n = 0, nn = pageLayouts.length; n < nn; n++) {
    if (pageLayouts[n] === pageLayout) {
      return cumulatedSize;
    }
    cumulatedSize += pageLayouts[n].getSize();
  }
  return -1;
}

function getBlockLayoutPositionInPageLayout(pageLayout: PageLayout, blockLayout: BlockLayout): number {
  const blockLayouts = pageLayout.getBlockLayouts();
  let cumulatedSize = 0;
  for (let n = 0, nn = blockLayouts.length; n < nn; n++) {
    if (blockLayouts[n] === blockLayout) {
      return cumulatedSize;
    }
    cumulatedSize += blockLayouts[n].getSize();
  }
  return -1;
}

function getLineLayoutPositionInBlockLayout(blockLayout: BlockLayout, lineLayout: LineLayout): number {
  const lineLayouts = blockLayout.getLineLayouts();
  let cumulatedSize = 0;
  for (let n = 0, nn = lineLayouts.length; n < nn; n++) {
    if (lineLayouts[n] === lineLayout) {
      return cumulatedSize;
    }
    cumulatedSize += lineLayouts[n].getSize();
  }
  return -1;
}

function getBoxLayoutPositionInLineLayout(lineLayout: LineLayout, boxLayout: BoxLayout): number {
  const boxLayouts = lineLayout.getBoxLayouts();
  let cumulatedSize = 0;
  for (let n = 0, nn = boxLayouts.length; n < nn; n++) {
    if (boxLayouts[n] === boxLayout) {
      return cumulatedSize;
    }
    cumulatedSize += boxLayouts[n].getSize();
  }
  return -1;
}

export default function resolveLayoutPosition(document: Document, position: number): BoxLayoutPosition | null {
  // Build document position
  const documentPosition = new DocumentPosition(document, position);

  // Build page layout position
  const pageLayout = document.getPageLayoutAt(documentPosition.getPosition());
  if (!pageLayout) {
    return null;
  }
  const pageLayoutPositionInDocument = getPageLayoutPositionInDocument(document, pageLayout);
  if (pageLayoutPositionInDocument < 0) {
    return null;
  }
  const pageLayoutPosition = new PageLayoutPosition(documentPosition, pageLayout, position - pageLayoutPositionInDocument);

  // Build block layout position
  const blockLayout = pageLayout.getBlockLayoutAt(pageLayoutPosition.getPosition());
  if (!blockLayout) {
    return null;
  }
  const blockLayoutPositionInPageLayout = getBlockLayoutPositionInPageLayout(pageLayout, blockLayout);
  if (blockLayoutPositionInPageLayout < 0) {
    return null;
  }
  const blockLayoutPosition = new BlockLayoutPosition(pageLayoutPosition, blockLayout, position - pageLayoutPositionInDocument - blockLayoutPositionInPageLayout);

  // Build line layout position
  const lineLayout = blockLayout.getLineLayoutAt(blockLayoutPosition.getPosition());
  if (!lineLayout) {
    return null;
  }
  const lineLayoutPositionInBlockLayout = getLineLayoutPositionInBlockLayout(blockLayout, lineLayout);
  if (lineLayoutPositionInBlockLayout < 0) {
    return null;
  }
  const lineLayoutPosition = new LineLayoutPosition(blockLayoutPosition, lineLayout, position - pageLayoutPositionInDocument - blockLayoutPositionInPageLayout - lineLayoutPositionInBlockLayout);

  // Build box layout position
  const boxLayout = lineLayout.getBoxLayoutAt(lineLayoutPosition.getPosition());
  if (!boxLayout) {
    return null;
  }
  const boxLayoutPositionInLineLayout = getBoxLayoutPositionInLineLayout(lineLayout, boxLayout);
  if (boxLayoutPositionInLineLayout < 0) {
    return null;
  }
  const boxLayoutPosition = new BoxLayoutPosition(lineLayoutPosition, boxLayout, position - pageLayoutPositionInDocument - blockLayoutPositionInPageLayout - lineLayoutPositionInBlockLayout - boxLayoutPositionInLineLayout);
  return boxLayoutPosition
}
