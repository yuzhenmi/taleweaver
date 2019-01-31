import PageView from './PageView';
import BoxView from './BoxView';

type LineViewConfig = {
  width: number;
}

export type LineViewScreenPosition = {
  left: number;
  width: number;
  height: number;
}

export default abstract class LineView {
  protected config: LineViewConfig;
  protected pageView?: PageView;
  protected boxViews: BoxView[];
  protected domElement?: HTMLElement;

  constructor(config: LineViewConfig) {
    this.config = config;
    this.boxViews = [];
  }

  setPageView(pageView: PageView) {
    this.pageView = pageView;
  }

  getBoxViews(): BoxView[] {
    return this.boxViews;
  }

  appendBoxView(boxView: BoxView) {
    this.boxViews.push(boxView);
  }

  removeBoxView(boxView: BoxView) {
    const index = this.boxViews.indexOf(boxView);
    if (index < 0) {
      return;
    }
    this.boxViews.splice(index, 1);
  }

  abstract bindToDOM(): void;

  getConfig(): LineViewConfig {
    return this.config;
  }

  getPageView(): PageView {
    return this.pageView!;
  }

  getDOMElement(): HTMLElement {
    return this.domElement!;
  }

  getHeight(): number {
    return Math.max(...this.boxViews.map(boxView => boxView.getHeight()));
  }

  getSize(): number {
    let size = 0;
    this.boxViews!.forEach(boxView => size += boxView.getSize());
    return size;
  }

  getScreenPosition(from: number, to: number): LineViewScreenPosition {
    let cumulatedSize = 0;
    let cumulatedWidth = 0;
    let left: number | null = null;
    for (let n = 0, nn = this.boxViews.length; n < nn; n++) {
      const boxView = this.boxViews[n];
      const boxViewSize = boxView.getSize();
      if (left === null) {
        // Left-bound has not been determined yet,
        // so we need to determine left bound,
        // and if the box at the left bound covers
        // the whole range then we return the screen
        // position of that box
        if (cumulatedSize + boxViewSize >= from) {
          // End of box is to the right of the beginning
          // of the range
          if (cumulatedSize + boxViewSize >= to) {
            // End of box is at or to the right of the end
            // of the range, this means the box fully covers
            // the range
            const boxViewScreenPosition = boxView.getScreenPosition(from - cumulatedSize, to - cumulatedSize);
            return {
              left: cumulatedWidth + boxViewScreenPosition.left,
              width: boxViewScreenPosition.width,
              height: boxViewScreenPosition.height,
            };
          }
          left = cumulatedWidth + boxView.getScreenPosition(from - cumulatedSize, boxViewSize).left;
        }
      } else {
        if (cumulatedSize + boxViewSize >= to) {
          const rightScreenPosition = boxView.getScreenPosition(0, to - cumulatedSize);
          const right = cumulatedWidth + rightScreenPosition.left + rightScreenPosition.width;
          return {
            left,
            width: right - left,
            height: this.getHeight(),
          };
        }
      }
      cumulatedSize += boxViewSize;
      cumulatedWidth += boxView.getWidth();
    }
    throw new Error(`Line screen position cannot be determined for range from ${from} to ${to}.`);
  }
}
