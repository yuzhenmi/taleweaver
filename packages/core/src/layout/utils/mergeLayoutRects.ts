import LayoutRect from '../LayoutRect';

export default function mergeLayoutRects(layoutRects: LayoutRect[]) {
  // Assume rects are sorted top to bottom, left to right
  for (let n = 0; n < layoutRects.length; n++) {
    const layoutRect = layoutRects[n];
    if (n === 0) {
      continue;
    }
    const previousLayoutRect = layoutRects[n - 1];
    if (layoutRect.top !== previousLayoutRect.top) {
      continue;
    }
    if (layoutRect.height !== previousLayoutRect.height) {
      continue;
    }
    if (layoutRect.left === previousLayoutRect.left + previousLayoutRect.width) {
      previousLayoutRect.width += layoutRect.width;
      previousLayoutRect.right = layoutRect.right;
      layoutRects.splice(n, 1);
      n -= 1;
    }
  }
}
