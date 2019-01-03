import BoxLayoutPosition from '../layout/BoxLayoutPosition';
import PageLayout from '../../layout/PageLayout';

type PageBoxPosition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export default function projectLayoutPositionRangeToPage(anchorLayoutPosition: BoxLayoutPosition, headLayoutPosition: BoxLayoutPosition, targetPageLayout: PageLayout): PageBoxPosition[] {
  // Sort layout positions
  let fromLayoutPosition: BoxLayoutPosition, toLayoutPosition: BoxLayoutPosition;
  const headPosition = headLayoutPosition.getLineLayoutPosition().getBlockLayoutPosition().getPageLayoutPosition().getDocumentPosition().getPosition();
  const anchorPosition = anchorLayoutPosition.getLineLayoutPosition().getBlockLayoutPosition().getPageLayoutPosition().getDocumentPosition().getPosition();
  if (headPosition < anchorPosition) {
    fromLayoutPosition = headLayoutPosition;
    toLayoutPosition = anchorLayoutPosition;
  } else {
    toLayoutPosition = headLayoutPosition;
    fromLayoutPosition = anchorLayoutPosition;
  }

  // Get page indices in document
  const pageLayouts = targetPageLayout.getDocument().getPageLayouts();
  const anchorPageLayout = anchorLayoutPosition.getLineLayoutPosition().getBlockLayoutPosition().getPageLayoutPosition().getPageLayout();
  const headPageLayout = headLayoutPosition.getLineLayoutPosition().getBlockLayoutPosition().getPageLayoutPosition().getPageLayout();
  const anchorPageIndex = pageLayouts.indexOf(anchorPageLayout);
  const headPageIndex = pageLayouts.indexOf(targetPageLayout);
  const targetPageIndex = pageLayouts.indexOf(targetPageLayout);

  // Return nothing if target page does not intersect with range between anchor and head
  if (headPageIndex < targetPageIndex && anchorPageIndex < targetPageIndex) {
    return [];
  }
  if (headPageIndex > targetPageIndex && anchorPageIndex > targetPageIndex) {
    return [];
  }

  // TODO

  return [];
}
