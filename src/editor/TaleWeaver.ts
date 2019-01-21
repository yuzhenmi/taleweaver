import DocumentElement from './element/DocumentElement';
import BlockElement from './element/BlockElement';
import InlineElement from './element/InlineElement';
import ParagraphElement from './element/ParagraphElement';
import TextElement from './element/TextElement';
import LineBreakElement from './element/LineBreakElement';
import DocumentView from './view/DocumentView';
import PageView from './view/PageView';
import LineView from './view/LineView';
import BoxView from './view/BoxView';
import ParagraphLineView from './view/ParagraphLineView';
import State from './state/State';

type DocumentElementType = new (...args: any[]) => DocumentElement;
type BlockElementType = new (...args: any[]) => BlockElement;
type InlineElementType = new (...args: any[]) => InlineElement;
type DocumentViewType = new (...args: any[]) => DocumentView;
type PageViewType = new (...args: any[]) => PageView;
type LineViewType = new (...args: any[]) => LineView;
type BoxViewType = new (...args: any[]) => BoxView;

export default class TaleWeaver {
  private documentElementType: DocumentElementType;
  private blockElementTypes: Map<string, BlockElementType>;
  private inlineElementTypes: Map<string, InlineElementType>;
  private documentViewType: DocumentViewType;
  private pageViewType: PageViewType;
  private lineViewTypes: Map<string, LineViewType>;
  private boxViewTypes: Map<string, BoxViewType>;
  private state?: State;
  private documentView?: DocumentView;

  constructor() {
    this.documentElementType = DocumentElement;
    this.blockElementTypes = new Map<string, BlockElementType>();
    this.inlineElementTypes = new Map<string, InlineElementType>();
    this.documentViewType = DocumentView;
    this.pageViewType = PageView;
    this.lineViewTypes = new Map<string, LineViewType>();
    this.boxViewTypes = new Map<string, BoxViewType>();
    this.registerBlockElementType('Paragraph', ParagraphElement);
    this.registerInlineElementType('Text', TextElement);
    this.registerInlineElementType('LineBreak', LineBreakElement);
    this.registerLineViewType('Paragraph', ParagraphLineView);
  }

  registerDocumentElementType(documentElementType: DocumentElementType) {
    this.documentElementType = documentElementType;
  }

  registerBlockElementType(type: string, blockElementType: BlockElementType) {
    this.blockElementTypes.set(type, blockElementType);
  }

  registerInlineElementType(type: string, inlineElementType: InlineElementType) {
    this.inlineElementTypes.set(type, inlineElementType);
  }

  registerDocumentViewType(documentViewType: DocumentViewType) {
    this.documentViewType = documentViewType;
  }

  registerPageViewType(pageViewType: PageViewType) {
    this.pageViewType = pageViewType;
  }

  registerLineViewType(type: string, lineViewType: LineViewType) {
    this.lineViewTypes.set(type, lineViewType);
  }

  registerBoxViewType(type: string, boxViewType: BoxViewType) {
    this.boxViewTypes.set(type, boxViewType);
  }

  setState(state: State) {
    this.state = state!;
  }

  setDocumentView(documentView: DocumentView) {
    this.documentView = documentView;
  }

  getDocumentElementType(): DocumentElementType {
    return this.documentElementType;
  }

  getBlockElementType(type: string): BlockElementType | undefined {
    return this.blockElementTypes.get(type);
  }

  getInlineElementType(type: string): InlineElementType | undefined {
    return this.inlineElementTypes.get(type);
  }

  getDocumentViewType(): DocumentViewType {
    return this.documentViewType;
  }

  getPageViewType(): PageViewType {
    return this.pageViewType;
  }

  getLineViewType(type: string): LineViewType | undefined {
    return this.lineViewTypes.get(type);
  }

  getBoxViewType(type: string): BoxViewType | undefined {
    return this.boxViewTypes.get(type);
  }

  getState(): State {
    return this.state!;
  }

  getDocumentView(): DocumentView {
    return this.documentView!;
  }

  attach(containerDOMElement: HTMLElement) {
    const DocumentView = this.getDocumentViewType();
    const documentView = new DocumentView();
    documentView.setDocumentElement(this.getState().getDocumentElement());
    documentView.setTaleWeaver(this);
    this.setDocumentView(documentView);
    this.getDocumentView().addToDOM(containerDOMElement);
  }
}