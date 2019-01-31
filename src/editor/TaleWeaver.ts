import DocumentElement from './element/DocumentElement';
import BlockElement from './element/BlockElement';
import InlineElement from './element/InlineElement';
import ParagraphElement from './element/block/ParagraphElement';
import TextElement from './element/inline/TextElement';
import DocumentView from './view/DocumentView';
import PageView from './view/PageView';
import LineView from './view/LineView';
import BoxView from './view/BoxView';
import ParagraphLineView from './view/ParagraphLineView';
import TextView from './view/TextView';
import State from './state/State';
import CursorTransformer from './state/CursorTransformer';

type DocumentElementClass = new (...args: any[]) => DocumentElement;
type BlockElementClass = new (...args: any[]) => BlockElement;
type InlineElementClass = new (...args: any[]) => InlineElement;
type DocumentViewClass = new (...args: any[]) => DocumentView;
type PageViewClass = new (...args: any[]) => PageView;
type LineViewClass = new (...args: any[]) => LineView;
type BoxViewClass = new (...args: any[]) => BoxView;

/**
 * Configs for TaleWeaver.
 */
type TaleWeaverConfig = {
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
}

/**
 * Registry for model element classes and view classes.
 * Useful for customizing and extending TaleWeaver.
 */
class TaleWeaverRegistry {
  /** Registered document element class. */
  private documentElementClass?: DocumentElementClass;
  /** Registered block element classes. */
  private blockElementClasses: Map<string, BlockElementClass>;
  /** Registered inline element classes. */
  private inlineElementClasses: Map<string, InlineElementClass>;
  /** Registered document view class. */
  private documentViewClass?: DocumentViewClass;
  /** Registered page view class. */
  private pageViewClass?: PageViewClass;
  /** Registered line view classes. */
  private lineViewClasses: Map<string, LineViewClass>;
  /** Registered box view classes. */
  private boxViewClasses: Map<string, BoxViewClass>;
  /** Registered cursor transformer. */
  private cursorTransformer?: CursorTransformer;

  /**
   * Creates a new TaleWeaver registry instance.
   */
  constructor() {
    // Init registry maps
    this.blockElementClasses = new Map<string, BlockElementClass>();
    this.inlineElementClasses = new Map<string, InlineElementClass>();
    this.lineViewClasses = new Map<string, LineViewClass>();
    this.boxViewClasses = new Map<string, BoxViewClass>();

    // Register defaults
    this.registerDocumentElementClass(DocumentElement);
    this.registerBlockElementClass('Paragraph', ParagraphElement);
    this.registerInlineElementClass('Text', TextElement);
    this.registerDocumentViewClass(DocumentView);
    this.registerPageViewClass(PageView);
    this.registerLineViewClass('Paragraph', ParagraphLineView);
    this.registerBoxViewClass('Text', TextView);
    this.registerCursorTransformer(new CursorTransformer());
  }

  /**
   * Registers the document element class.
   * @param documentElementClass - Document element class to register.
   */
  registerDocumentElementClass(documentElementClass: DocumentElementClass) {
    this.documentElementClass = documentElementClass;
  }

  /**
   * Gets the registered document element class.
   */
  getDocumentElementClass(): DocumentElementClass {
    if (!this.documentElementClass) {
      throw new Error('No document element class registered.');
    }
    return this.documentElementClass;
  }

  /**
   * Registers a block element class by type.
   * @param type - Type of the block element class.
   * @param blockElementClass - Block element class to register.
   */
  registerBlockElementClass(type: string, blockElementClass: BlockElementClass) {
    this.blockElementClasses.set(type, blockElementClass);
  }

  /**
   * Gets a registered block element class by type.
   * @param type - Type of the block element class.
   */
  getBlockElementClass(type: string): BlockElementClass {
    const blockElementClass = this.blockElementClasses.get(type);
    if (!blockElementClass) {
      throw new Error(`Unregistered block element class type: ${type}.`);
    }
    return blockElementClass;
  }

  /**
   * Registers an inline element class by type.
   * @param type - Type of the inline element class.
   * @param inlineElementClass - Inline element class to register.
   */
  registerInlineElementClass(type: string, inlineElementClass: InlineElementClass) {
    this.inlineElementClasses.set(type, inlineElementClass);
  }

  /**
   * Gets a registered inline element class by type.
   * @param type - Type of the inline element class.
   */
  getInlineElementClass(type: string): InlineElementClass {
    const inlineElementClass = this.inlineElementClasses.get(type);
    if (!inlineElementClass) {
      throw new Error(`Unregistered inline element class type: ${type}.`);
    }
    return inlineElementClass;
  }

  /**
   * Registers the document view class.
   * @param documentViewClass - Document view class to register.
   */
  registerDocumentViewClass(documentViewClass: DocumentViewClass) {
    this.documentViewClass = documentViewClass;
  }

  /**
   * Gets the registered document view class.
   */
  getDocumentViewClass(): DocumentViewClass {
    if (!this.documentViewClass) {
      throw new Error('No document view class registered.');
    }
    return this.documentViewClass;
  }

  /**
   * Registers the page view class.
   * @param pageViewClass - Page view class to register.
   */
  registerPageViewClass(pageViewClass: PageViewClass) {
    this.pageViewClass = pageViewClass;
  }

  /**
   * Gets the registered page view class.
   */
  getPageViewClass(): PageViewClass {
    if (!this.pageViewClass) {
      throw new Error('No page view class registered.');
    }
    return this.pageViewClass;
  }

  /**
   * Regsiters a line view class by type.
   * @param type - Type of the line view class.
   * @param lineViewClass - Line view class to register.
   */
  registerLineViewClass(type: string, lineViewClass: LineViewClass) {
    this.lineViewClasses.set(type, lineViewClass);
  }

  /**
   * Gets a registered line view class by type.
   * @param type - Type of the line view class.
   */
  getLineViewClass(type: string): LineViewClass {
    const lineViewClass = this.lineViewClasses.get(type);
    if (!lineViewClass) {
      throw new Error(`Unregistered line view class: ${type}.`);
    }
    return lineViewClass;
  }

  /**
   * Registers a box view class by type.
   * @param type - Type of the box view class.
   * @param boxViewType - Box view class to register.
   */
  registerBoxViewClass(type: string, boxViewClass: BoxViewClass) {
    this.boxViewClasses.set(type, boxViewClass);
  }

  /**
   * Gets a registered box view class by type.
   * @param type - Type of the box view class.
   */
  getBoxViewClass(type: string): BoxViewClass {
    const boxViewClass = this.boxViewClasses.get(type);
    if (!boxViewClass) {
      throw new Error(`Unregistered box view class: ${type}.`);
    }
    return boxViewClass;
  }

  /**
   * Registers the cursor transformer.
   * @param cursorTransformer - Cursor transformer to register.
   */
  registerCursorTransformer(cursorTransformer: CursorTransformer) {
    this.cursorTransformer = cursorTransformer;
  }

  /**
   * Gets the registered cursor transformer.
   */
  getCursorTransformer(): CursorTransformer {
    if (!this.cursorTransformer) {
      throw new Error('No cursor transformer registered.');
    }
    return this.cursorTransformer;
  }
}

/**
 * Root of TaleWeaver, holds things together.
 */
export default class TaleWeaver {
  private config: TaleWeaverConfig;
  private registry: TaleWeaverRegistry;
  private state?: State;
  private documentView?: DocumentView;

  /**
   * Creates a new TaleWeaver instance.
   * @param config - Configs for TaleWeaver.
   */
  constructor(config: TaleWeaverConfig) {
    this.config = config;
    this.registry = new TaleWeaverRegistry();
  }

  /**
   * Gets the registry.
   */
  getRegistry(): TaleWeaverRegistry {
    return this.registry;
  }

  /**
   * Gets the configs.
   */
  getConfig(): TaleWeaverConfig {
    return this.config;
  }

  /**
   * Sets the state.
   * @param state - State to set.
   */
  setState(state: State) {
    this.state = state!;
  }

  /**
   * Gets the state.
   */
  getState(): State {
    return this.state!;
  }

  /**
   * Sets the document view.
   * @param documentView - The document view to set.
   */
  setDocumentView(documentView: DocumentView) {
    this.documentView = documentView;
  }

  /**
   * Gets the document view.
   */
  getDocumentView(): DocumentView {
    return this.documentView!;
  }

  /**
   * Attaches TaleWeaver to the DOM.
   * @param containerDOMElement - Container DOM element to attach TaleWeaver to.
   */
  attach(containerDOMElement: HTMLElement) {
    const DocumentView = this.registry.getDocumentViewClass();
    const documentView = new DocumentView(this, {
      pageWidth: this.config.pageWidth,
      pageHeight: this.config.pageHeight,
      pagePaddingTop: this.config.pagePaddingTop,
      pagePaddingBottom: this.config.pagePaddingBottom,
      pagePaddingLeft: this.config.pagePaddingLeft,
      pagePaddingRight: this.config.pagePaddingRight,
    });
    documentView.setDocumentElement(this.getState().getDocumentElement());
    this.setDocumentView(documentView);
    this.getDocumentView().addToDOM(containerDOMElement);
  }
}
