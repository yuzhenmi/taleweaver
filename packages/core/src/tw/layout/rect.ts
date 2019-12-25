export interface ILayoutRect {
    width: number;
    height: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
    paddingTop: number;
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
}

export type IPageLayoutRect = ILayoutRect[];

export function mergeLayoutRects(rects: ILayoutRect[]) {
    // Assume rects are sorted top to bottom, left to right
    for (let n = 0; n < rects.length; n++) {
        const rect = rects[n];
        if (n === 0) {
            continue;
        }
        const previousRect = rects[n - 1];
        if (rect.top !== previousRect.top) {
            continue;
        }
        if (rect.height !== previousRect.height) {
            continue;
        }
        if (rect.left === previousRect.left + previousRect.width) {
            previousRect.width += rect.width;
            previousRect.right = rect.right;
            rects.splice(n, 1);
            n -= 1;
        }
    }
}
