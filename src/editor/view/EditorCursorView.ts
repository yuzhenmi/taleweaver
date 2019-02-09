import TaleWeaver from '../TaleWeaver';
import Cursor from '../cursor/Cursor';
import DocumentView from './DocumentView';
import { moveTo, moveHeadTo } from '../command/cursor';
import isElementInViewport from '../helpers/isElementInViewport';

export default class EditorCursorView {
  private taleWeaver: TaleWeaver;
  private editorCursor: Cursor;
  private documentView?: DocumentView;
  private headDOMElement?: HTMLElement;
  private selectionDOMElements: HTMLElement[];
  private selecting: boolean;
  private blinkState: boolean;
  private blinkInterval: NodeJS.Timeout | null;
  private lineViewX: number | null;
  private lastLineViewX: number;

  constructor(taleWeaver: TaleWeaver, editorCursor: Cursor) {
    this.taleWeaver = taleWeaver;
    this.editorCursor = editorCursor;
    this.selectionDOMElements = [];
    this.selecting = false;
    this.blinkState = false;
    this.blinkInterval = null;
    this.lineViewX = null;
    this.lastLineViewX = 0;
  }

  private render(preserveLineViewPosition: boolean = false) {
    this.renderHead(preserveLineViewPosition);
    this.renderSelections();
  }

  private renderHead(preserveLineViewPosition: boolean) {
    const editorCursor = this.editorCursor;
    const head = editorCursor.getHead();
    const documentScreenSelection = this.documentView!.getScreenSelection(head, head);
    const { pageView, pageViewScreenSelection } = documentScreenSelection[0];
    const headDOMElement = this.headDOMElement!;
    headDOMElement.style.left = `${pageViewScreenSelection[0].x1}px`;
    headDOMElement.style.top = `${pageViewScreenSelection[0].y1}px`;
    headDOMElement.style.height = `${pageViewScreenSelection[0].y2 - pageViewScreenSelection[0].y1}px`;
    const pageViewDOMElement = pageView.getContentDOMElement();
    if (headDOMElement.parentElement && headDOMElement.parentElement !== pageViewDOMElement) {
      headDOMElement.parentElement!.removeChild(headDOMElement);
    }
    if (!headDOMElement.parentElement) {
      pageViewDOMElement.appendChild(headDOMElement);
    }
    if (preserveLineViewPosition) {
      if (this.lineViewX === null) {
        this.lineViewX = this.lastLineViewX;
      }
    } else {
      this.lineViewX = null;
    }
    this.lastLineViewX = pageViewScreenSelection[0].x1;

    // Scroll view port to head if head is out of view port
    if (!isElementInViewport(headDOMElement)) {
      headDOMElement.scrollIntoView();
    }
  }

  private renderSelections() {
    const editorCursor = this.editorCursor;
    const anchor = editorCursor.getAnchor();
    const head = editorCursor.getHead();
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const documentScreenSelection = this.documentView!.getScreenSelection(from, to);
    let selectionsCount = 0;
    documentScreenSelection.forEach(({ pageViewScreenSelection }) => {
      selectionsCount += pageViewScreenSelection.length;
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
    documentScreenSelection.forEach(({ pageView, pageViewScreenSelection }) => {
      const pageViewDOMElement = pageView.getContentDOMElement();
      pageViewScreenSelection.forEach(pageViewScreenPosition => {
        const selectionDOMElement = this.selectionDOMElements[selectionIndex]!;
        selectionDOMElement.style.left = `${pageViewScreenPosition.x1}px`;
        selectionDOMElement.style.width = `${pageViewScreenPosition.x2 - pageViewScreenPosition.x1}px`;
        selectionDOMElement.style.top = `${pageViewScreenPosition.y1}px`;
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

  getLineViewX(): number | null {
    return this.lineViewX;
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
    this.editorCursor.observe((editorCursor, extraArgs) => {
      this.render(extraArgs.preserveLineViewPosition);
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
    this.taleWeaver.getState().applyEditorCursorTransformation(moveTo(position)(this.taleWeaver));
    this.selecting = true;
    this.stopBlinking();
  }

  moveSelect(position: number) {
    if (this.selecting) {
      this.taleWeaver.getState().applyEditorCursorTransformation(moveHeadTo(position)(this.taleWeaver));
    }
  }

  endSelect(position: number) {
    this.taleWeaver.getState().applyEditorCursorTransformation(moveHeadTo(position)(this.taleWeaver));
    this.selecting = false;
    this.startBlinking();
  }
}
