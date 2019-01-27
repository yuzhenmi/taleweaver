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
    const documentScreenPositions = this.documentView!.getScreenPositions(head, head);
    const { pageView, pageViewScreenPositions } = documentScreenPositions[0];
    const headDOMElement = this.headDOMElement!;
    headDOMElement.style.left = `${pageViewScreenPositions[0].left + pageView.getConfig().paddingLeft}px`;
    headDOMElement.style.top = `${pageViewScreenPositions[0].top + pageView.getConfig().paddingTop}px`;
    headDOMElement.style.height = `${pageViewScreenPositions[0].height}px`;
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
    const documentScreenPositions = this.documentView!.getScreenPositions(from, to);
    let selectionsCount = 0;
    documentScreenPositions.forEach(({ pageViewScreenPositions }) => {
      selectionsCount += pageViewScreenPositions.length;
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
    documentScreenPositions.forEach(({ pageView, pageViewScreenPositions }) => {
      const pageViewDOMElement = pageView.getDOMElement();
      pageViewScreenPositions.forEach(pageViewScreenPosition => {
        const selectionDOMElement = this.selectionDOMElements[selectionIndex]!;
        selectionDOMElement.style.left = `${pageViewScreenPosition.left + pageView.getConfig().paddingLeft}px`;
        selectionDOMElement.style.width = `${pageViewScreenPosition.width}px`;
        selectionDOMElement.style.top = `${pageViewScreenPosition.top + pageView.getConfig().paddingTop}px`;
        selectionDOMElement.style.height = `${pageViewScreenPosition.height}px`;
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

  addToDOM() {
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
