import LayoutEngine from '../layout/LayoutEngine';
import ViewportBoundingRect from '../layout/ViewportBoundingRect';
import Presenter from '../view/Presenter';
import Extension from './Extension';

export default class ExtensionProvider {
  protected layoutEngine: LayoutEngine;
  protected presenter: Presenter;
  protected extensions: Extension[];

  constructor(layoutEngine: LayoutEngine, presenter: Presenter) {
    this.layoutEngine = layoutEngine;
    this.presenter = presenter;
    this.extensions = [];
    layoutEngine.subscribeOnReflowed(this.handleReflowed);
    presenter.subscribeOnMounted(this.handleReflowed);
  }

  registerExtension(extension: Extension) {
    this.extensions.push(extension);
    extension.onRegistered(this);
  }

  resolveViewportPositionToSelectableOffset(pageOffset: number, x: number, y: number): number {
    return this.layoutEngine.getDocLayout().resolveViewportPositionToSelectableOffset(pageOffset, x, y);
  }

  resolveSelectableOffsetRangeToViewportBoundingRects(from: number, to: number): ViewportBoundingRect[][] {
    return this.layoutEngine.getDocLayout().resolveSelectableOffsetRangeToViewportBoundingRects(from, to);
  }

  getPageDOMContentContainer(pageOffset: number): HTMLDivElement {
    return this.presenter.getPageDOMContentContainer(pageOffset);
  }

  private handleReflowed = () => {
    this.extensions.forEach(extension => {
      if (!extension.onReflowed) {
        return;
      }
      extension.onReflowed();
    });
  }
}
