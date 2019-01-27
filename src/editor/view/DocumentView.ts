import TaleWeaver from '../TaleWeaver';
import DocumentElement from '../element/DocumentElement';
import BlockElement from '../element/BlockElement';
import PageView, { PageViewScreenPositions } from './PageView';
import BoxView from './BoxView';
import LineView from './LineView';
import EditorCursorView from './EditorCursorView';
import ObserverCursorView from './ObserverCursorView';
import Event from './helpers/Event';

type BoxViewBlock = {
  blockElement: BlockElement;
  boxViews: BoxView[];
};

type DocumentViewConfig = {
  pageWidth: number;
  pageHeight: number;
  pagePaddingTop: number;
  pagePaddingBottom: number;
  pagePaddingLeft: number;
  pagePaddingRight: number;
};

export type DocumentViewScreenPositions = {
  pageView: PageView;
  pageViewScreenPositions: PageViewScreenPositions;
}[];

export default class DocumentView {
  private config: DocumentViewConfig;
  private documentElement?: DocumentElement;
  private taleWeaver?: TaleWeaver;
  private pageViews: PageView[];
  private boxViewBlocks: BoxViewBlock[];
  private lineViews: LineView[];
  private editorCursorViews: EditorCursorView[];
  private observerCursorViews: ObserverCursorView[];
  private domElement?: HTMLElement;
  private cursorBlinkState: boolean;
  private cursorBlinkInterval?: NodeJS.Timeout;

  constructor(config: DocumentViewConfig) {
    this.config = config;
    this.boxViewBlocks = [];
    this.lineViews = [];
    this.pageViews = [];
    this.editorCursorViews = [];
    this.observerCursorViews = [];
    this.cursorBlinkState = false;
  }

  private buildBoxViewBlocks() {
    this.boxViewBlocks.length = 0;
    this.getDocumentElement().getChildren().forEach(blockElement => {
      const boxViewBlock: BoxViewBlock = {
        blockElement,
        boxViews: [],
      };
      blockElement.getChildren().forEach(inlineElement => {
        const atoms = inlineElement.getAtoms();
        atoms.forEach(atom => {
          const BoxView = this.getTaleWeaver().getBoxViewType(atom.getType())!;
          const boxView = new BoxView();
          boxView.setAtom(atom);
          boxViewBlock.boxViews.push(boxView);
        });
      });
      this.boxViewBlocks.push(boxViewBlock);
    });
  }

  private buildLineViews() {
    this.lineViews.length = 0;
    const maxWidth = this.config.pageWidth - this.config.pagePaddingLeft - this.config.pagePaddingRight;
    this.boxViewBlocks.forEach(boxViewBlock => {
      const LineView = this.getTaleWeaver().getLineViewType(boxViewBlock.blockElement.getType())!;
      let lineView = new LineView();
      this.lineViews.push(lineView);
      let cumulatedWidth = 0;
      boxViewBlock.boxViews.forEach(boxView => {
        if (cumulatedWidth + boxView.getWidth() > maxWidth) {
          lineView = new LineView();
          this.lineViews.push(lineView);
          cumulatedWidth = 0;
        }
        boxView.setLineView(lineView);
        lineView.appendBoxView(boxView);
        cumulatedWidth += boxView.getWidth();
      });
    });
  }

  private buildPageViews() {
    this.pageViews.length = 0;
    let pageView = new PageView(this, {
      onPointerDown: this.handlePointerDownOnPage,
      onPointerUp: this.handlePointerUpOnPage,
    }, {
      width: this.config.pageWidth,
      height: this.config.pageHeight,
      paddingTop: this.config.pagePaddingTop,
      paddingBottom: this.config.pagePaddingBottom,
      paddingLeft: this.config.pagePaddingLeft,
      paddingRight: this.config.pagePaddingRight,
    });
    this.pageViews.push(pageView);
    let cumulatedHeight = 0;
    const maxHeight = this.config.pageHeight - this.config.pagePaddingTop - this.config.pagePaddingBottom;
    this.lineViews.forEach(lineView => {
      if (cumulatedHeight + lineView.getHeight() > maxHeight) {
        pageView = new PageView(this, {
          onPointerDown: this.handlePointerDownOnPage,
          onPointerUp: this.handlePointerUpOnPage,
        }, {
          width: this.config.pageWidth,
          height: this.config.pageHeight,
          paddingTop: this.config.pagePaddingTop,
          paddingBottom: this.config.pagePaddingBottom,
          paddingLeft: this.config.pagePaddingLeft,
          paddingRight: this.config.pagePaddingRight,
        });
        this.pageViews.push(pageView);
        cumulatedHeight = 0;
      }
      lineView.setPageView(pageView);
      pageView.appendLineView(lineView);
      cumulatedHeight += lineView.getHeight();
    });
  }

  private handlePointerDownOnPage = (event: Event) => {
    const pageView: PageView = event.pageView;
    const pageViewPosition: number = event.pageViewPosition;
    let cumulatedSize = 0;
    for (let n = 0, nn = this.pageViews.length; n < nn; n++) {
      const loopPageView = this.pageViews[n];
      if (loopPageView === pageView) {
        break;
      }
      cumulatedSize += loopPageView.getSize();
    }
    const position = cumulatedSize + pageViewPosition;
    // TODO: Notify editor cursor state changed
  }

  private handlePointerUpOnPage = (event: Event) => {
    const pageView: PageView = event.pageView;
    const pageViewPosition: number = event.pageViewPosition;
  }

  buildEditorCursorViews() {
    this.getDocumentElement().getState().getEditorCursors().forEach(editorCursor => {
      const editorCursorView = new EditorCursorView();
      editorCursorView.setEditorCursor(editorCursor);
      editorCursorView.setDocumentView(this);
      this.editorCursorViews.push(editorCursorView);
    });
  }

  buildObserverCursorViews() {
    this.getDocumentElement().getState().getObserverCursors().forEach(observerCursor => {
      const observerCursorView = new ObserverCursorView();
      observerCursorView.setObserverCursor(observerCursor);
      observerCursorView.setDocumentView(this);
      this.observerCursorViews.push(observerCursorView);
    });
  }

  setDocumentElement(documentElement: DocumentElement) {
    this.documentElement = documentElement;
    this.buildBoxViewBlocks();
    this.buildLineViews();
    this.buildPageViews();
    this.buildEditorCursorViews();
    this.buildObserverCursorViews();
  }

  setTaleWeaver(taleWeaver: TaleWeaver) {
    this.taleWeaver = taleWeaver;
  }

  removePageView(pageView: PageView) {
    const index = this.pageViews.indexOf(pageView);
    if (index < 0) {
      return;
    }
    this.pageViews.splice(index, 1);
  }

  addToDOM(containerDOMElement: HTMLElement) {
    if (this.domElement) {
      return;
    }
    this.domElement = document.createElement('div');
    this.domElement.className = 'tw--document';
    this.pageViews.forEach(pageView => pageView.addToDOM());
    this.editorCursorViews.forEach(editorCursorView => editorCursorView.addToDOM());
    this.observerCursorViews.forEach(observerCursorView => observerCursorView.addToDOM());
    containerDOMElement.appendChild(this.domElement);
    this.cursorBlinkInterval = setInterval(() => {
      if (this.cursorBlinkState) {
        this.editorCursorViews.forEach(editorCursorView => editorCursorView.hideHead());
      } else {
        this.editorCursorViews.forEach(editorCursorView => editorCursorView.showHead());
      }
      this.cursorBlinkState = !this.cursorBlinkState;
    }, 500);
  }

  getConfig(): DocumentViewConfig {
    return this.config;
  }

  getDocumentElement(): DocumentElement {
    return this.documentElement!;
  }

  getTaleWeaver(): TaleWeaver {
    return this.taleWeaver!;
  }

  getDOMElement(): HTMLElement {
    return this.domElement!;
  }

  getScreenPositions(from: number, to: number): DocumentViewScreenPositions {
    let cumulatedSize = 0;
    const documentScreenPositions: DocumentViewScreenPositions = [];
    for (let n = 0, nn = this.pageViews.length; n < nn; n++) {
      const pageView = this.pageViews[n];
      const pageViewSize = pageView.getSize();
      if (from - cumulatedSize < pageViewSize) {
        documentScreenPositions.push({
          pageView,
          pageViewScreenPositions: pageView.getScreenPositions(from - cumulatedSize, Math.min(to - cumulatedSize, pageViewSize)),
        });
      }
      cumulatedSize += pageViewSize;
      if (to <= cumulatedSize) {
        return documentScreenPositions;
      }
    }
    throw new Error(`Document screen positions cannot be determined for range from ${from} to ${to}.`);
  }
}
