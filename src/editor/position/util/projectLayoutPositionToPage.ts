import BoxLayoutPosition from '../layout/BoxLayoutPosition';
import PageLayout from '../../layout/PageLayout';

type PagePosition = {
  x: number;
  y: number;
  height: number;
};

export default function projectLayoutPositionToPage(position: BoxLayoutPosition, targetPageLayout: PageLayout): PagePosition | null {
  const pageLayout = position
    .getLineLayoutPosition()
    .getBlockLayoutPosition()
    .getPageLayoutPosition()
    .getPageLayout();
  const blockLayout = position
    .getLineLayoutPosition()
    .getBlockLayoutPosition()
    .getBlockLayout();
  const lineLayout = position
    .getLineLayoutPosition()
    .getLineLayout();
  const boxLayout = position.getBoxLayout();

  // Return null if the layout position is not on the target page
  if (pageLayout !== targetPageLayout) {
    return null;
  }

  // Determine y coordinate
  let cumulatedHeight = 0;
  for (let n = 0, nn = pageLayout.getBlockLayouts().length; n < nn; n++) {
    const loopBlockLayout = pageLayout.getBlockLayouts()[n];
    if (loopBlockLayout === blockLayout) {
      break;
    }
    cumulatedHeight += loopBlockLayout.getHeight();
  }
  for (let n = 0, nn = blockLayout.getLineLayouts().length; n < nn; n++) {
    const loopLineLayout = blockLayout.getLineLayouts()[n];
    if (loopLineLayout === lineLayout) {
      break;
    }
    cumulatedHeight += loopLineLayout.getHeight();
  }

  // Determine x coordinate
  let cumulatedWidth = 0;
  for (let n = 0, nn = lineLayout.getBoxLayouts().length; n < nn; n++) {
    const loopBoxLayout = lineLayout.getBoxLayouts()[n];
    if (loopBoxLayout === boxLayout) {
      break;
    }
    cumulatedWidth += loopBoxLayout.getWidth();
  }
  return {
    x: cumulatedWidth,
    y: cumulatedHeight,
    height: boxLayout.getHeight(),
  };
}
