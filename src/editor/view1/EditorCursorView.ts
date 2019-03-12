import TaleWeaver from '../TaleWeaver';
import Cursor from '../cursor/Cursor';
import DocView from './DocView';
import { moveTo, moveHeadTo } from '../cursor/commands';
import isElementInViewport from '../helpers/isElementInViewport';

export default class EditorCursorView {
  private taleWeaver: TaleWeaver;
  private editorCursor: Cursor;
  private docView?: DocView;
  private domHead?: HTMLElement;
  private domSelections: HTMLElement[];
  private selecting: boolean;
  private blinkState: boolean;
  private blinkInterval: NodeJS.Timeout | null;
  private lineViewX: number | null;
  private lastLineViewX: number;

  constructor(taleWeaver: TaleWeaver, editorCursor: Cursor) {
    this.taleWeaver = taleWeaver;
    this.editorCursor = editorCursor;
    this.domSelections = [];
    this.selecting = false;
    this.blinkState = false;
    this.blinkInterval = null;
    this.lineViewX = null;
    this.lastLineViewX = 0;
  }

  private render(keepX: boolean = false) {
    this.renderHead(keepX);
    this.renderSelections();
    this.updateNativeCursor();
  }

  private renderHead(keepX: boolean) {
    const editorCursor = this.editorCursor;
    const head = editorCursor.getHead();
    const viewPositionBoxes = this.docView!.mapModelPositionRangeToViewPositionBoxes(head, head);
    const { pageView, pageViewPositionBox } = viewPositionBoxes[0];
    const domHead = this.domHead!;
    domHead.style.left = `${pageViewPositionBox.x1}px`;
    domHead.style.top = `${pageViewPositionBox.y1}px`;
    domHead.style.height = `${pageViewPositionBox.y2 - pageViewPositionBox.y1}px`;
    const { domPageContent } = pageView.getDOM();
    if (domHead.parentElement && domHead.parentElement !== domPageContent) {
      domHead.parentElement!.removeChild(domHead);
    }
    if (!domHead.parentElement) {
      domPageContent.appendChild(domHead);
    }
    if (keepX) {
      if (this.lineViewX === null) {
        this.lineViewX = this.lastLineViewX;
      }
    } else {
      this.lineViewX = null;
    }
    this.lastLineViewX = pageViewPositionBox.x1;

    // Scroll view port to head if head is out of view port
    if (!isElementInViewport(domHead)) {
      domHead.scrollIntoView({ block: 'nearest' });
    }
  }

  private renderSelections() {
    const editorCursor = this.editorCursor;
    const anchor = editorCursor.getAnchor();
    const head = editorCursor.getHead();
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const viewPositionBoxes = this.docView!.mapModelPositionRangeToViewPositionBoxes(from, to);
    let selectionsCount = viewPositionBoxes.length;
    while (this.domSelections.length > selectionsCount) {
      const domSelection = this.domSelections.pop()!;
      domSelection.parentElement!.removeChild(domSelection);
    }
    while (this.domSelections.length < selectionsCount) {
      const domSelection = document.createElement('div');
      domSelection.className = 'tw--editor-cursor-selection';
      domSelection.style.position = 'absolute';
      domSelection.style.background = 'hsla(217, 100%, 65%, 0.25)';
      this.domSelections.push(domSelection);
    }
    let selectionIndex = 0;
    viewPositionBoxes.forEach(({ pageView, pageViewPositionBox }) => {
      const { domPageContent } = pageView.getDOM();
      const domSelection = this.domSelections[selectionIndex]!;
      domSelection.style.left = `${pageViewPositionBox.x1}px`;
      domSelection.style.width = `${pageViewPositionBox.x2 - pageViewPositionBox.x1}px`;
      domSelection.style.top = `${pageViewPositionBox.y1}px`;
      domSelection.style.height = `${pageViewPositionBox.y2 - pageViewPositionBox.y1}px`;
      domSelection.style.pointerEvents = 'none';
      if (domSelection.parentElement && domSelection.parentElement !== domPageContent) {
        domSelection.parentElement!.removeChild(domSelection);
      }
      if (!domSelection.parentElement) {
        domPageContent.appendChild(domSelection);
      }
      selectionIndex++;
    });
  }

  private updateNativeCursor() {
    const docView = this.taleWeaver.getDocView();
    const anchor = this.editorCursor.getAnchor();
    const head = this.editorCursor.getHead();
    const viewAwareAnchorPosition = docView.resolveModelPosition(anchor);
    const viewAwareHeadPosition = docView.resolveModelPosition(head);
    const { domWordContent } = viewAwareAnchorPosition.wordView.getDOM();
    const selection = getSelection();
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNode(domWordContent);
    selection.addRange(range);
  }

  getLineViewX(): number | null {
    return this.lineViewX;
  }

  setDocView(docView: DocView) {
    this.docView = docView;
  }

  mount() {
    if (!this.domHead) {
      this.domHead = document.createElement('div');
      this.domHead.className = 'tw--editor-cursor-head';
      this.domHead.style.position = 'absolute';
      this.domHead.style.width = '2px';
      this.domHead.style.marginLeft = '-1px';
      this.domHead.style.background = 'hsla(217, 100%, 65%, 1)';
      this.domHead.style.visibility = 'hidden';
    }
    this.render();
    this.startBlinking();
    this.editorCursor.observe((editorCursor, keepX) => {
      this.render(keepX);
      if (this.blinkInterval !== null) {
        this.stopBlinking();
        this.startBlinking();
      }
    });
  }

  getEditorCursor(): Cursor {
    return this.editorCursor;
  }

  getDocView(): DocView {
    return this.docView!;
  }

  startBlinking() {
    if (this.blinkInterval !== null) {
      return;
    }
    this.blinkInterval = setInterval(() => {
      if (this.blinkState) {
        this.domHead!.style.visibility = 'hidden';
      } else {
        this.domHead!.style.visibility = 'visible';
      }
      this.blinkState = !this.blinkState;
    }, 500);
  }

  stopBlinking() {
    if (this.blinkInterval === null) {
      return;
    }
    this.blinkState = true;
    this.domHead!.style.visibility = 'visible';
    clearInterval(this.blinkInterval);
    this.blinkInterval = null;
  }

  beginSelect(position: number) {
    this.editorCursor.transform(moveTo(position)(this.taleWeaver));
    this.selecting = true;
    this.stopBlinking();
  }

  moveSelect(position: number) {
    if (this.selecting) {
      this.editorCursor.transform(moveHeadTo(position)(this.taleWeaver));
    }
  }

  endSelect(position: number) {
    this.editorCursor.transform(moveHeadTo(position)(this.taleWeaver));
    this.selecting = false;
    this.startBlinking();
  }
}
