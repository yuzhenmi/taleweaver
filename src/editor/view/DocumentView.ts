import TaleWeaver from '../TaleWeaver';
import DocumentElement from '../element/DocumentElement';
import BlockElement from '../element/BlockElement';
import PageView from './PageView';
import BoxView from './BoxView';
import LineView from './LineView';

type BoxViewBlock = {
  blockElement: BlockElement;
  boxViews: BoxView[];
}

type DocumentViewConfig = {
  pageWidth: number;
  pageHeight: number;
  pagePaddingTop: number;
  pagePaddingBottom: number;
  pagePaddingLeft: number;
  pagePaddingRight: number;
}

export default class DocumentView {
  private config: DocumentViewConfig;
  private documentElement?: DocumentElement;
  private taleWeaver?: TaleWeaver;
  private pageViews: PageView[];
  private boxViewBlocks: BoxViewBlock[];
  private lineViews: LineView[];
  private domElement?: HTMLElement;

  constructor(config: DocumentViewConfig) {
    this.config = config;
    this.boxViewBlocks = [];
    this.lineViews = [];
    this.pageViews = [];
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
    let pageView = new PageView({
      width: this.config.pageWidth,
      height: this.config.pageHeight,
      paddingTop: this.config.pagePaddingTop,
      paddingBottom: this.config.pagePaddingBottom,
      paddingLeft: this.config.pagePaddingLeft,
      paddingRight: this.config.pagePaddingRight,
    });
    pageView.setDocumentView(this);
    this.pageViews.push(pageView);
    let cumulatedHeight = 0;
    const maxHeight = this.config.pageHeight - this.config.pagePaddingTop - this.config.pagePaddingBottom;
    this.lineViews.forEach(lineView => {
      if (cumulatedHeight + lineView.getHeight() > maxHeight) {
        pageView = new PageView({
          width: this.config.pageWidth,
          height: this.config.pageHeight,
          paddingTop: this.config.pagePaddingTop,
          paddingBottom: this.config.pagePaddingBottom,
          paddingLeft: this.config.pagePaddingLeft,
          paddingRight: this.config.pagePaddingRight,
        });
        pageView.setDocumentView(this);
        this.pageViews.push(pageView);
        cumulatedHeight = 0;
      }
      lineView.setPageView(pageView);
      pageView.appendLineView(lineView);
      cumulatedHeight += lineView.getHeight();
    });
  }

  setDocumentElement(documentElement: DocumentElement) {
    this.documentElement = documentElement;
    this.buildBoxViewBlocks();
    this.buildLineViews();
    this.buildPageViews();
  }

  setTaleWeaver(taleWeaver: TaleWeaver) {
    this.taleWeaver = taleWeaver;
  }

  appendPageView(pageView: PageView) {
    this.pageViews.push(pageView);
    pageView.setDocumentView(this);
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
    containerDOMElement.appendChild(this.domElement);
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
}
