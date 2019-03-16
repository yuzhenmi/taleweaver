import ViewportBoundingRect from '../ViewportBoundingRect';

export default function mergeViewportBoundingRects(viewportBoundingRects: ViewportBoundingRect[]) {
  // Assume input viewport bounding rects are sorted top to bottom, left to right
  for (let n = 0; n < viewportBoundingRects.length; n++) {
    const viewportBoundingRect = viewportBoundingRects[n];
    if (n === 0) {
      continue;
    }
    const previousViewportBoundingRect = viewportBoundingRects[n - 1];
    if (viewportBoundingRect.top !== previousViewportBoundingRect.top){
      continue;
    }
    if (viewportBoundingRect.height !== previousViewportBoundingRect.height) {
      continue;
    }
    if (viewportBoundingRect.left === previousViewportBoundingRect.left + previousViewportBoundingRect.width) {
      previousViewportBoundingRect.width += viewportBoundingRect.width;
      previousViewportBoundingRect.right = viewportBoundingRect.right;
      viewportBoundingRects.splice(n, 1);
      n -= 1;
    }
  }
}
