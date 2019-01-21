import DocumentElement from './element/DocumentElement';
import BlockElement from './element/BlockElement';
import InlineElement from './element/InlineElement';
import ParagraphElement from './element/ParagraphElement';
import TextElement from './element/TextElement';
import LineBreakElement from './element/LineBreakElement';
import DocumentView from './view/DocumentView';
import PageView from './view/PageView';
import BlockView from './view/BlockView';
import LineView from './view/LineView';
import BoxView from './view/BoxView';
import ParagraphView from './view/ParagraphView';
import State from './state/State';

type DocumentElementType = new (...args: any[]) => DocumentElement;
type BlockElementType = new (...args: any[]) => BlockElement;
type InlineElementType = new (...args: any[]) => InlineElement;
type DocumentViewType = new (...args: any[]) => DocumentView;
type PageViewType = new (...args: any[]) => PageView;
type BlockViewType = new (...args: any[]) => BlockView;
type LineViewType = new (...args: any[]) => LineView;
type BoxViewType = new (...args: any[]) => BoxView;

export default class TaleWeaver {
  private documentElementType: DocumentElementType;
  private blockElementTypes: Map<string, BlockElementType>;
  private inlineElementTypes: Map<string, InlineElementType>;
  private documentViewType: DocumentViewType;
  private pageViewType: PageViewType;
  private blockViewTypes: Map<string, BlockViewType>;
  private lineViewType: LineViewType;
  private boxViewTypes: Map<string, BoxViewType>;
  private state?: State;
  private documentView?: DocumentView;

  constructor() {
    this.documentElementType = DocumentElement;
    this.blockElementTypes = new Map<string, BlockElementType>();
    this.inlineElementTypes = new Map<string, InlineElementType>();
    this.documentViewType = DocumentView;
    this.pageViewType = PageView;
    this.blockViewTypes = new Map<string, BlockViewType>();
    this.lineViewType = LineView;
    this.boxViewTypes = new Map<string, BoxViewType>();
    this.registerBlockElementType('Paragraph', ParagraphElement);
    this.registerInlineElementType('Text', TextElement);
    this.registerInlineElementType('LineBreak', LineBreakElement);
    this.registerBlockViewType('Paragraph', ParagraphView);
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

  registerBlockViewType(type: string, blockViewType: BlockViewType) {
    this.blockViewTypes.set(type, blockViewType);
  }

  registerLineViewType(lineViewType: LineViewType) {
    this.lineViewType = lineViewType;
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

  getBlockViewType(type: string): BlockViewType | undefined {
    return this.blockViewTypes.get(type);
  }

  getLineViewType(): LineViewType {
    return this.lineViewType;
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
    const documentView = new DocumentView();
    documentView.setTaleWeaver(this);
    documentView.setDocumentElement(this.getState().getDocumentElement());
    this.setDocumentView(documentView);
    this.getDocumentView().addToDOM(containerDOMElement);
  }
}
