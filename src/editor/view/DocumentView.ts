import TaleWeaver from '../TaleWeaver';
import DocumentElement from '../model/DocumentElement';
import BlockElement from '../model/BlockElement';
import throttle from '../helpers/throttle';
import PageView, { PageViewPositionBox, PageViewAwarePosition } from './PageView';
import WordView from './WordView';
import LineView from './LineView';
import EditorCursorView from './EditorCursorView';
import { KeyPressEvent } from '../event/Event';

/**
 * Box views of a block element, useful
 * as an intermediate data structure
 * where the word views can be further
 * broken down into line views.
 */
interface WordViewBlock {
  blockElement: BlockElement;
  wordViews: WordView[];
};

/**
 * Document view configs.
 */
interface DocumentViewConfig {
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

export interface DocumentViewDOMElements {
  domDocument: HTMLDivElement;
  domDocumentContent: HTMLDivElement;
}

export interface DocumentViewPositionBox {
  pageView: PageView;
  pageViewPositionBox: PageViewPositionBox;
};

export interface DocumentViewAwarePosition extends PageViewAwarePosition {
  documentView: DocumentView;
  documentViewPosition: number;
};

/**
 * View of a document.
 */
export default class DocumentView {
  private taleWeaver: TaleWeaver;
  private documentElement: DocumentElement;
  private config: DocumentViewConfig;

  private wordViewBlocks: WordViewBlock[];
  private lineViews: LineView[];
  private pageViews: PageView[];
  private editorCursorView: EditorCursorView | null;

  private mounted: boolean;
  private domDocument?: HTMLDivElement;
  private domDocumentContent?: HTMLDivElement;

  /**
   * Creates a new document view instance.
   * @param taleWeaver - A TaleWeaver instance.
   * @param config - Configs for the document view.
   */
  constructor(taleWeaver: TaleWeaver, documentElement: DocumentElement, config: DocumentViewConfig) {
    this.taleWeaver = taleWeaver;
    this.documentElement = documentElement;
    this.config = config;

    this.wordViewBlocks = [];
    this.lineViews = [];
    this.pageViews = [];
    this.editorCursorView = null;

    this.mounted = false;
    
    // Build child views
    this.buildWordViewBlocks();
    this.buildLineViews();
    this.buildPageViews();
    this.buildEditorCursorView();
  }

  /**
   * Gets the model size of the document.
   */
  getSize(): number {
    return this.documentElement.getSize();
  }

  /**
   * Gets the child page views.
   */
  getPageViews(): PageView[] {
    return this.pageViews;
  }

  /**
   * Gets the child editor cursor view.
   */
  getEditorCursorView(): EditorCursorView | null {
    return this.editorCursorView;
  }

  /**
   * Mounts the view to DOM.
   * @param domWrapper - DOM wrapper for the document view.
   */
  mount(domWrapper: HTMLElement) {
    // Do not mount if already mounted
    if (this.mounted) {
      return;
    }

    // Build document element
    this.domDocument = document.createElement('div');
    this.domDocument.className = 'tw--document';
    domWrapper.appendChild(this.domDocument);

    // Build document content element
    this.domDocumentContent = document.createElement('div');
    this.domDocumentContent.className = 'tw--document-content';
    this.domDocument.appendChild(this.domDocumentContent);

    // Mount page views
    this.pageViews.forEach(pageView => pageView.mount());

    // Attach event listeners
    this.domDocument.addEventListener('selectstart', this.handleSelectStart);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  /**
   * Gets DOM elements mounted by the view.
   */
  getDOM(): DocumentViewDOMElements {
    return {
      domDocument: this.domDocument!,
      domDocumentContent: this.domDocumentContent!,
    };
  }

  /**
   * Maps a model position range to view position boxes.
   * @param from - Left-bound of the model position range.
   * @param to - Right-bound of the model position range.
   */
  mapModelPositionRangeToViewPositionBoxes(from: number, to: number): DocumentViewPositionBox[] {
    // Iterate through pages to break up model position range
    const viewPositionBoxes: DocumentViewPositionBox[] = [];
    let offset = 0;
    for (let n = 0, nn = this.pageViews.length; n < nn; n++) {
      const pageView = this.pageViews[n];
      // If overlap between position range and page
      if (from <= offset + pageView.getSize() && to > offset) {
        // Get page view position boxes
        const pageViewPositionBoxes = pageView.mapModelPositionRangeToViewPositionBoxes(
          Math.max(0, from - offset),
          Math.min(pageView.getSize(), to - offset),
        );
        // Map page view position boxes to document view position boxes
        pageViewPositionBoxes.forEach(pageViewPositionBox => {
          viewPositionBoxes.push({
            pageView,
            pageViewPositionBox,
          });
        });
      }
      offset += pageView.getSize();
    }
    return viewPositionBoxes;
  }

  /**
   * Maps a view position to model position.
   * @param x - X-coordinate of the view position.
   * @param y - Y-coordinate of the view position.
   */
  mapViewPositionToModelPosition(x: number, y: number): number {
    // Iterate through pages until the page that contains the view position
    // is found
    let offset = 0;
    let cumulatedHeight = 0;
    for (let n = 0, nn = this.pageViews.length; n < nn; n++) {
      const pageView = this.pageViews[n];
      // If posterior of page is past Y-coordinate
      if (cumulatedHeight + pageView.getHeight() >= y) {
        // Get model position in page
        const pageModelPosition = pageView.mapViewPositionToModelPosition(
          x,
          y - cumulatedHeight,
        );
        // Map page model position to document model position
        return offset + pageModelPosition;
      }
      offset += pageView.getSize();
      cumulatedHeight += pageView.getHeight();
    }
    throw new Error(`Cannot map document view position ${x}, ${y} to model position.`);
  }

  /**
   * Resolves a flat model position to a view-aware position
   * object.
   * @param position - Flat model position to resolve.
   */
  resolveModelPosition(position: number): DocumentViewAwarePosition {
    // Iterate through pages until the page that contains the view position
    // is found
    let offset = 0;
    for (let n = 0, nn = this.pageViews.length; n < nn; n++) {
      const pageView = this.pageViews[n];
      // If posterior of page is past position
      if (offset + pageView.getSize() >= position) {
        // Resolve model position in page
        const pageViewAwarePosition = pageView.resolveModelPosition(position - offset);
        // Map page view aware position to document view aware position
        return {
          ...pageViewAwarePosition,
          documentView: this,
          documentViewPosition: position,
        };
      }
      offset += pageView.getSize();
    }
    throw new Error(`Cannot resolve document model position ${position}.`);
  }

  /**
   * Builds word views for each block element in
   * the document.
   */
  private buildWordViewBlocks() {
    const registry = this.taleWeaver.getRegistry();
    // Reset wordViewBlocks
    this.wordViewBlocks.length = 0;
    // Loop through block elements in the document
    this.documentElement.getChildren().forEach(blockElement => {
      const wordViewBlock: WordViewBlock = {
        blockElement,
        wordViews: [],
      };
      // Loop through inline elements in the block element
      blockElement.getChildren().forEach(inlineElement => {
        const words = inlineElement.getWords();
        // Loop through words in the inline element
        words.forEach(word => {
          // Build word view from word
          const WordView = registry.getWordViewClass(word.getType())!;
          const wordView = new WordView(word, {});
          wordViewBlock.wordViews.push(wordView);
        });
      });
      this.wordViewBlocks.push(wordViewBlock);
    });
  }

  /**
   * Builds line views from word views, should not
   * be called unless buildWordViewBlocks was called.
   */
  private buildLineViews() {
    // Reset lineViews
    this.lineViews.length = 0;
    const registry = this.taleWeaver.getRegistry();
    // Determine page content width as width minus paddings
    const pageContentWidth = this.config.pageWidth - this.config.pagePaddingLeft - this.config.pagePaddingRight;
    // Loop through blocks of word views
    this.wordViewBlocks.forEach(wordViewBlock => {
      // Build line views for block
      const LineView = registry.getLineViewClass(wordViewBlock.blockElement.getType())!;
      let lineView = new LineView({
        width: this.config.pageWidth - this.config.pagePaddingLeft - this.config.pagePaddingRight,
      });
      this.lineViews.push(lineView);
      let cumulatedWidth = 0;
      // Loop through word views in block
      wordViewBlock.wordViews.forEach(wordView => {
        // Start new line if current line i is full
        if (cumulatedWidth + wordView.getWidth() > pageContentWidth) {
          lineView = new LineView({
            width: this.config.pageWidth - this.config.pagePaddingLeft - this.config.pagePaddingRight,
          });
          this.lineViews.push(lineView);
          cumulatedWidth = 0;
        }
        // Append word view to current line view
        wordView.setLineView(lineView);
        lineView.appendWordView(wordView);
        cumulatedWidth += wordView.getWidth();
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
    let pageView = new PageView(this, pageViewConigs);
    this.pageViews.push(pageView);
    let cumulatedHeight = 0;
    // Determine page content height as height minus paddings
    const pageContentHeight = this.config.pageHeight - this.config.pagePaddingTop - this.config.pagePaddingBottom;
    // Loop through line views
    this.lineViews.forEach(lineView => {
      // Start new page if current page is full
      if (cumulatedHeight + lineView.getHeight() > pageContentHeight) {
        pageView = new PageView(this, pageViewConigs);
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
   * Handles selectstart DOM event.
   */
  private handleSelectStart = (event: Event) => {
    // Disable browser select functionality
    event.preventDefault();
  }

  /**
   * Handles mouse down DOM event.
   */
  private handleMouseDown = (event: MouseEvent) => {
    // No need to handle mouse down if no editor cursor
    if (!this.editorCursorView) {
      return;
    }
    const position = this.mapViewPositionToModelPosition(event.pageX, event.pageY);
    this.editorCursorView.beginSelect(position);
  }

  /**
   * Handles mouse move DOM event.
   */
  private handleMouseMove = throttle((event: MouseEvent) => {
    // No need to handle mouse down if no editor cursor
    if (!this.editorCursorView) {
      return;
    }
    const position = this.mapViewPositionToModelPosition(event.pageX, event.pageY);
    this.editorCursorView.endSelect(position);
  }, 5)

  /**
   * Handles mouse up DOM event.
   */
  private handleMouseUp = (event: MouseEvent) => {
    // No need to handle mouse down if no editor cursor
    if (!this.editorCursorView) {
      return;
    }
    const position = this.mapViewPositionToModelPosition(event.pageX, event.pageY);
    this.editorCursorView.endSelect(position);
  }

  /**
   * Handles key down DOM event.
   */
  private handleKeyDown = (event: KeyboardEvent) => {
    this.taleWeaver.getState().dispatchEvent(new KeyPressEvent(event.key, event.shiftKey, event.metaKey, event.altKey));
    event.preventDefault();
  }

  /**
   * Handles key up DOM event.
   */
  private handleKeyUp = (event: KeyboardEvent) => {
  }
}
