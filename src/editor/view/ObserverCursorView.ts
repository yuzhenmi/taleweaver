import Cursor from '../cursor/Cursor';
import DocumentView from './DocumentView';

export default class ObserverCursorView {
  private observerCursor?: Cursor;
  private documentView?: DocumentView;
  private headDOMElement?: HTMLElement;
  private selectionDOMElements: HTMLElement[];

  constructor() {
    this.selectionDOMElements = [];
  }

  private render() {
    this.renderHead();
    this.renderSelections();
  }

  private renderHead() {
    const observerCursor = this.observerCursor!;
    const head = observerCursor.getHead();
    const documentScreenPositions = this.documentView!.getScreenSelection(head, head);
    const { pageView, pageViewScreenSelection } = documentScreenPositions[0];
    const headDOMElement = this.headDOMElement!;
    headDOMElement.style.left = `${pageViewScreenSelection[0].x1 + pageView.getConfig().paddingLeft}px`;
    headDOMElement.style.top = `${pageViewScreenSelection[0].y1 + pageView.getConfig().paddingTop}px`;
    headDOMElement.style.height = `${pageViewScreenSelection[0].y2 - pageViewScreenSelection[0].y1}px`;
    const pageViewDOMElement = pageView.getDOMElement();
    if (headDOMElement.parentElement && headDOMElement.parentElement !== pageViewDOMElement) {
      headDOMElement.parentElement!.removeChild(headDOMElement);
    }
    if (!headDOMElement.parentElement) {
      pageViewDOMElement.appendChild(headDOMElement);
    }
  }

  private renderSelections() {
    const observerCursor = this.observerCursor!;
    const anchor = observerCursor.getAnchor();
    const head = observerCursor.getHead();
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const documentScreenPositions = this.documentView!.getScreenSelection(from, to);
    let selectionsCount = 0;
    documentScreenPositions.forEach(({ pageViewScreenSelection }) => {
      selectionsCount += pageViewScreenSelection.length;
    });
    while (this.selectionDOMElements.length > selectionsCount) {
      this.selectionDOMElements.pop();
    }
    while (this.selectionDOMElements.length < selectionsCount) {
      const selectionDOMElement = document.createElement('div');
      selectionDOMElement.className = 'tw--observer-cursor-selection';
      selectionDOMElement.style.position = 'absolute';
      selectionDOMElement.style.background = 'hsla(130, 100%, 65%, 0.25)';
      this.selectionDOMElements.push(selectionDOMElement);
    }
    let selectionIndex = 0;
    documentScreenPositions.forEach(({ pageView, pageViewScreenSelection }) => {
      const pageViewDOMElement = pageView.getDOMElement();
      pageViewScreenSelection.forEach(pageViewScreenPosition => {
        const selectionDOMElement = this.selectionDOMElements[selectionIndex]!;
        selectionDOMElement.style.left = `${pageViewScreenPosition.x1 + pageView.getConfig().paddingLeft}px`;
        selectionDOMElement.style.width = `${pageViewScreenPosition.x2 - pageViewScreenPosition.x1}px`;
        selectionDOMElement.style.top = `${pageViewScreenPosition.y1 + pageView.getConfig().paddingTop}px`;
        selectionDOMElement.style.height = `${pageViewScreenPosition.y2 - pageViewScreenPosition.y1}px`;
        selectionDOMElement.style.pointerEvents = 'none';
        if (selectionDOMElement.parentElement && selectionDOMElement.parentElement !== pageViewDOMElement) {
          selectionDOMElement.parentElement!.removeChild(selectionDOMElement);
        }
        if (!selectionDOMElement.parentElement) {
          pageViewDOMElement.appendChild(selectionDOMElement);
        }
        selectionIndex++;
      });
    });
  }

  setObserverCursor(observerCursor: Cursor) {
    this.observerCursor = observerCursor;
  }

  setDocumentView(documentView: DocumentView) {
    this.documentView = documentView;
  }

  bindToDOM() {
    if (!this.headDOMElement) {
      this.headDOMElement = document.createElement('div');
      this.headDOMElement.className = 'tw--observer-cursor-head';
      this.headDOMElement.style.position = 'absolute';
      this.headDOMElement.style.width = '2px';
      this.headDOMElement.style.marginLeft = '-1px';
      this.headDOMElement.style.background = 'hsla(130, 100%, 65%, 1)';
    }
    this.render();
  }

  getObserverCursor(): Cursor {
    return this.observerCursor!;
  }

  getDocumentView(): DocumentView {
    return this.documentView!;
  }
}
