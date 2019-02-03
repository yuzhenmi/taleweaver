import TaleWeaver from '../TaleWeaver';
import Cursor from '../cursor/Cursor';
import DocumentView from './DocumentView';
import { moveTo, moveHeadTo } from '../state/helpers/editorCursorTransformations';

export default class EditorCursorView {
  private taleWeaver: TaleWeaver;
  private editorCursor: Cursor;
  private documentView?: DocumentView;
  private headDOMElement?: HTMLElement;
  private selectionDOMElements: HTMLElement[];
  private selecting: boolean;
  private blinkState: boolean;
  private blinkInterval: NodeJS.Timeout | null;

  constructor(taleWeaver: TaleWeaver, editorCursor: Cursor) {
    this.taleWeaver = taleWeaver;
    this.editorCursor = editorCursor;
    this.selectionDOMElements = [];
    this.selecting = false;
    this.blinkState = false;
    this.blinkInterval = null;
  }

  private render() {
    this.renderHead();
    this.renderSelections();
  }

  private renderHead() {
    const editorCursor = this.editorCursor;
    const head = editorCursor.getHead();
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
    const editorCursor = this.editorCursor;
    const anchor = editorCursor.getAnchor();
    const head = editorCursor.getHead();
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const documentScreenPositions = this.documentView!.getScreenPositions(from, to);
    let selectionsCount = 0;
    documentScreenPositions.forEach(({ pageViewScreenPositions }) => {
      selectionsCount += pageViewScreenPositions.length;
    });
    while (this.selectionDOMElements.length > selectionsCount) {
      const selectionDOMElement = this.selectionDOMElements.pop()!;
      selectionDOMElement.parentElement!.removeChild(selectionDOMElement);
    }
    while (this.selectionDOMElements.length < selectionsCount) {
      const selectionDOMElement = document.createElement('div');
      selectionDOMElement.className = 'tw--editor-cursor-selection';
      selectionDOMElement.style.position = 'absolute';
      selectionDOMElement.style.background = 'hsla(217, 100%, 65%, 0.25)';
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

  setDocumentView(documentView: DocumentView) {
    this.documentView = documentView;
  }

  bindToDOM() {
    if (!this.headDOMElement) {
      this.headDOMElement = document.createElement('div');
      this.headDOMElement.className = 'tw--editor-cursor-head';
      this.headDOMElement.style.position = 'absolute';
      this.headDOMElement.style.width = '2px';
      this.headDOMElement.style.marginLeft = '-1px';
      this.headDOMElement.style.background = 'hsla(217, 100%, 65%, 1)';
      this.headDOMElement.style.visibility = 'hidden';
    }
    this.render();
    this.startBlinking();
    this.editorCursor.observe(() => {
      this.render();
      if (this.blinkInterval !== null) {
        this.stopBlinking();
        this.startBlinking();
      }
    });
  }

  getEditorCursor(): Cursor {
    return this.editorCursor;
  }

  getDocumentView(): DocumentView {
    return this.documentView!;
  }

  startBlinking() {
    if (this.blinkInterval !== null) {
      return;
    }
    this.blinkInterval = setInterval(() => {
      if (this.blinkState) {
        this.headDOMElement!.style.visibility = 'hidden';
      } else {
        this.headDOMElement!.style.visibility = 'visible';
      }
      this.blinkState = !this.blinkState;
    }, 500);
  }

  stopBlinking() {
    if (this.blinkInterval === null) {
      return;
    }
    this.blinkState = true;
    this.headDOMElement!.style.visibility = 'visible';
    clearInterval(this.blinkInterval);
    this.blinkInterval = null;
  }

  beginSelect(position: number) {
    this.taleWeaver.getState().transformEditorCursor(moveTo(position));
    this.selecting = true;
    this.stopBlinking();
  }

  moveSelect(position: number) {
    if (this.selecting) {
      this.taleWeaver.getState().transformEditorCursor(moveHeadTo(position));
    }
  }

  endSelect(position: number) {
    this.taleWeaver.getState().transformEditorCursor(moveHeadTo(position));
    this.selecting = false;
    this.startBlinking();
  }
}
