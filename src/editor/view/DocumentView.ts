import TaleWeaver from '../TaleWeaver';
import DocumentElement from '../element/DocumentElement';
import BlockElement from '../element/BlockElement';
import PageView, { PageViewScreenPositions, PageViewPointerEvent } from './PageView';
import BoxView from './BoxView';
import LineView from './LineView';
import EditorCursorView from './EditorCursorView';
import ObserverCursorView from './ObserverCursorView';
import { translateCursor } from '../state/helpers/cursorTransformations';

/**
 * Box views of a block element, useful
 * as an intermediate data structure
 * where the box views can be further
 * broken down into line views.
 */
type BoxViewBlock = {
  blockElement: BlockElement;
  boxViews: BoxView[];
};

/**
 * Document view configs.
 */
type DocumentViewConfig = {
  /** Width of a page in the document. */
  pageWidth: number;
  /** Height of a page in the document. */
  pageHeight: number;
  /** Topping padding of a page in the document. */
  pagePaddingTop: number;
  /** Bottom padding of a page in the document. */
  pagePaddingBottom: number;
  /** Left padding of a page in the document. */
  pagePaddingLeft: number;
  /** Right padding of a page in the document. */
  pagePaddingRight: number;
};

export type DocumentViewScreenPositions = {
  pageView: PageView;
  pageViewScreenPositions: PageViewScreenPositions;
}[];

/**
 * View of a document.
 */
export default class DocumentView {
  private taleWeaver: TaleWeaver;
  private documentElement: DocumentElement;
  private config: DocumentViewConfig;
  private pageViews: PageView[];
  private boxViewBlocks: BoxViewBlock[];
  private lineViews: LineView[];
  private editorCursorView: EditorCursorView | null;
  private observerCursorViews: ObserverCursorView[];
  private domElement?: HTMLElement;

  /**
   * Creates a new document view instance.
   * @param taleWeaver - A TaleWeaver instance.
   * @param config - Configs for the document view.
   */
  constructor(taleWeaver: TaleWeaver, documentElement: DocumentElement, config: DocumentViewConfig) {
    this.taleWeaver = taleWeaver;
    this.documentElement = documentElement;
    this.config = config;
    this.boxViewBlocks = [];
    this.lineViews = [];
    this.pageViews = [];
    this.editorCursorView = null;
    this.observerCursorViews = [];
    
    // Build child views
    this.buildBoxViewBlocks();
    this.buildLineViews();
    this.buildPageViews();
    this.buildEditorCursorView();
    this.buildObserverCursorViews();
  }

  /**
   * Builds box views for each block element in
   * the document.
   */
  private buildBoxViewBlocks() {
    const registry = this.taleWeaver.getRegistry();
    // Reset boxViewBlocks
    this.boxViewBlocks.length = 0;
    // Loop through block elements in the document
    this.documentElement.getChildren().forEach(blockElement => {
      const boxViewBlock: BoxViewBlock = {
        blockElement,
        boxViews: [],
      };
      // Loop through inline elements in the block element
      blockElement.getChildren().forEach(inlineElement => {
        const atoms = inlineElement.getAtoms();
        // Loop through atoms in the inline element
        atoms.forEach(atom => {
          // Build box view from atom
          const BoxView = registry.getBoxViewClass(atom.getType())!;
          const boxView = new BoxView();
          boxView.setAtom(atom);
          boxViewBlock.boxViews.push(boxView);
        });
      });
      this.boxViewBlocks.push(boxViewBlock);
    });
  }

  /**
   * Builds line views from box views, should not
   * be called unless buildBoxViewBlocks was called.
   */
  private buildLineViews() {
    // Reset lineViews
    this.lineViews.length = 0;
    const registry = this.taleWeaver.getRegistry();
    // Determine page content width as width minus paddings
    const pageContentWidth = this.config.pageWidth - this.config.pagePaddingLeft - this.config.pagePaddingRight;
    // Loop through blocks of box views
    this.boxViewBlocks.forEach(boxViewBlock => {
      // Build line views for block
      const LineView = registry.getLineViewClass(boxViewBlock.blockElement.getType())!;
      let lineView = new LineView({
        width: this.config.pageWidth - this.config.pagePaddingLeft - this.config.pagePaddingRight,
      });
      this.lineViews.push(lineView);
      let cumulatedWidth = 0;
      // Loop through box views in block
      boxViewBlock.boxViews.forEach(boxView => {
        // Start new line if current line i is full
        if (cumulatedWidth + boxView.getWidth() > pageContentWidth) {
          lineView = new LineView({
            width: this.config.pageWidth - this.config.pagePaddingLeft - this.config.pagePaddingRight,
          });
          this.lineViews.push(lineView);
          cumulatedWidth = 0;
        }
        // Append box view to current line view
        boxView.setLineView(lineView);
        lineView.appendBoxView(boxView);
        cumulatedWidth += boxView.getWidth();
      });
    });
  }

  /**
   * Builds page views from line views, should not
   * be called unless buildLineViews was called.
   */
  private buildPageViews() {
    // Reset pageViews
    this.pageViews.length = 0;
    // Build page views
    const pageViewConigs = {
      width: this.config.pageWidth,
      height: this.config.pageHeight,
      paddingTop: this.config.pagePaddingTop,
      paddingBottom: this.config.pagePaddingBottom,
      paddingLeft: this.config.pagePaddingLeft,
      paddingRight: this.config.pagePaddingRight,
    };
    let pageView = new PageView(this, {
      onPointerDown: this.handlePointerDownOnPage,
      onPointerMove: this.handlePointerMoveOnPage,
      onPointerUp: this.handlePointerUpOnPage,
    }, pageViewConigs);
    this.pageViews.push(pageView);
    let cumulatedHeight = 0;
    // Determine page content height as height minus paddings
    const pageContentHeight = this.config.pageHeight - this.config.pagePaddingTop - this.config.pagePaddingBottom;
    // Loop through line views
    this.lineViews.forEach(lineView => {
      // Start new page if current page is full
      if (cumulatedHeight + lineView.getHeight() > pageContentHeight) {
        pageView = new PageView(this, {
          onPointerDown: this.handlePointerDownOnPage,
          onPointerMove: this.handlePointerMoveOnPage,
          onPointerUp: this.handlePointerUpOnPage,
        }, pageViewConigs);
        this.pageViews.push(pageView);
        cumulatedHeight = 0;
      }
      // Append line view to page view
      lineView.setPageView(pageView);
      pageView.appendLineView(lineView);
      cumulatedHeight += lineView.getHeight();
    });
  }

  /**
   * Resolves a position in a page view to a position
   * in the document view.
   */
  private resolvePageViewPosition = (pageViewPosition: number, pageView: PageView): number => {
    let cumulatedSize = 0;
    for (let n = 0, nn = this.pageViews.length; n < nn; n++) {
      const loopPageView = this.pageViews[n];
      if (loopPageView === pageView) {
        break;
      }
      cumulatedSize += loopPageView.getSize();
    }
    return cumulatedSize + pageViewPosition;
  }

  /**
   * Builds editor cursor views.
   */
  private buildEditorCursorView() {
    const editorCursor = this.taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return;
    }
    this.editorCursorView = new EditorCursorView(this.taleWeaver!, editorCursor);
    this.editorCursorView.setDocumentView(this);
  }

  /**
   * Builds observer cursor views.
   */
  private buildObserverCursorViews() {
    this.taleWeaver.getState().getObserverCursors().forEach(observerCursor => {
      const observerCursorView = new ObserverCursorView();
      observerCursorView.setObserverCursor(observerCursor);
      observerCursorView.setDocumentView(this);
      this.observerCursorViews.push(observerCursorView);
    });
  }

  private handlePointerDownOnPage = (event: PageViewPointerEvent) => {
    if (!this.editorCursorView) {
      return;
    }
    const position = this.resolvePageViewPosition(event.pageViewPosition, event.pageView);
    this.editorCursorView.beginSelect(position);
  }

  private handlePointerMoveOnPage = (event: PageViewPointerEvent) => {
    if (!this.editorCursorView) {
      return;
    }
    const position = this.resolvePageViewPosition(event.pageViewPosition, event.pageView);
    this.editorCursorView.moveSelect(position);
  }

  private handlePointerUpOnPage = (event: PageViewPointerEvent) => {
    if (!this.editorCursorView) {
      return;
    }
    const position = this.resolvePageViewPosition(event.pageViewPosition, event.pageView);
    this.editorCursorView.endSelect(position);
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      this.taleWeaver!.getState().transformCursor(translateCursor(-1));
    } else if (event.key === 'ArrowRight') {
      this.taleWeaver!.getState().transformCursor(translateCursor(1));
    } else if (event.key === 'ArrowUp') {
    } else if (event.key === 'ArrowDown') {
    } else {
      return;
    }
    event.preventDefault();
  }

  /**
   * Binds the document view to the DOM.
   * @param containerDOMElement - Container DOM element for the document.
   */
  bindToDOM(containerDOMElement: HTMLElement) {
    if (this.domElement) {
      return;
    }
    this.domElement = document.createElement('div');
    this.domElement.className = 'tw--document';
    this.pageViews.forEach(pageView => pageView.bindToDOM());
    if (this.editorCursorView) {
      this.editorCursorView.bindToDOM();
      this.observerCursorViews.forEach(observerCursorView => observerCursorView.bindToDOM());
      containerDOMElement.appendChild(this.domElement);
    }
    window.addEventListener('keydown', this.handleKeyDown);
  }

  /**
   * Gets the bound DOM element.
   */
  getDOMElement(): HTMLElement {
    return this.domElement!;
  }

  getScreenPositions(from: number, to: number): DocumentViewScreenPositions {
    let cumulatedSize = 0;
    const documentScreenPositions: DocumentViewScreenPositions = [];
    for (let n = 0, nn = this.pageViews.length; n < nn; n++) {
      const pageView = this.pageViews[n];
      const pageViewSize = pageView.getSize();
      if (cumulatedSize + pageViewSize >= from) {
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
