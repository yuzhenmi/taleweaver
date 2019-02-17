import Doc from './model/Doc';
import Block from './model/block/Block';
import Word from './model/word/Word';
import Paragraph from './model/block/Paragraph';
import TextWord from './model/word/TextWord';
import DocView from './view/DocView';
import PageView from './view/PageView';
import LineView from './view/LineView';
import WordView from './view/WordView';
import ParagraphLineView from './view/ParagraphLineView';
import TextView from './view/TextView';
import State from './state/State';
import CursorTransformer from './state/CursorTransformer';
import DocumentTransformer from './state/DocumentTransformer';
import EventObserver from './event/EventObserver';
import EditorCursorEventObserver from './event/EditorCursorEventObserver';
import DocumentEventObserver from './event/DocumentEventObserver';

type DocClass = new (...args: any[]) => Doc;
type BlockClass = new (...args: any[]) => Block;
type WordClass = new (...args: any[]) => Word;
type DocViewClass = new (...args: any[]) => DocView;
type PageViewClass = new (...args: any[]) => PageView;
type LineViewClass = new (...args: any[]) => LineView;
type WordViewClass = new (...args: any[]) => WordView;

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
  /** TaleWeaver instance. */
  private taleWeaver: TaleWeaver;
  /** Registered document element class. */
  private docClass?: DocClass;
  /** Registered block element classes. */
  private blockClasses: Map<string, BlockClass>;
  /** Registered inline element classes. */
  private wordClasses: Map<string, WordClass>;
  /** Registered document view class. */
  private docViewClass?: DocViewClass;
  /** Registered page view class. */
  private pageViewClass?: PageViewClass;
  /** Registered line view classes. */
  private lineViewClasses: Map<string, LineViewClass>;
  /** Registered box view classes. */
  private wordViewClasses: Map<string, WordViewClass>;
  /** Registered cursor transformer. */
  private cursorTransformer?: CursorTransformer;
  /** Registered document transformer. */
  private documentTransformer?: DocumentTransformer;
  /** Registered event handlers. */
  private eventObservers: EventObserver[];

  /**
   * Creates a new TaleWeaver registry instance.
   */
  constructor(taleWeaver: TaleWeaver) {
    this.taleWeaver = taleWeaver;

    // Init registry maps
    this.blockClasses = new Map<string, BlockClass>();
    this.wordClasses = new Map<string, WordClass>();
    this.lineViewClasses = new Map<string, LineViewClass>();
    this.wordViewClasses = new Map<string, WordViewClass>();
    this.eventObservers = [];

    // Register defaults
    this.registerDocClass(Doc);
    this.registerBlockClass('Paragraph', Paragraph);
    this.registerWordClass('Text', TextWord);
    this.registerDocViewClass(DocView);
    this.registerPageViewClass(PageView);
    this.registerLineViewClass('Paragraph', ParagraphLineView);
    this.registerWordViewClass('Text', TextView);
    this.registerCursorTransformer(new CursorTransformer());
    this.registerDocumentTransformer(new DocumentTransformer());
    this.registerEventObserver(new EditorCursorEventObserver(this.taleWeaver));
    this.registerEventObserver(new DocumentEventObserver(this.taleWeaver));
  }

  /**
   * Registers the document element class.
   * @param docClass - Document element class to register.
   */
  registerDocClass(docClass: DocClass) {
    this.docClass = docClass;
  }

  /**
   * Gets the registered document element class.
   */
  getDocClass(): DocClass {
    if (!this.docClass) {
      throw new Error('No document element class registered.');
    }
    return this.docClass;
  }

  /**
   * Registers a block element class by type.
   * @param type - Type of the block element class.
   * @param blockClass - Block element class to register.
   */
  registerBlockClass(type: string, blockClass: BlockClass) {
    this.blockClasses.set(type, blockClass);
  }

  /**
   * Gets a registered block element class by type.
   * @param type - Type of the block element class.
   */
  getBlockClass(type: string): BlockClass {
    const blockClass = this.blockClasses.get(type);
    if (!blockClass) {
      throw new Error(`Unregistered block element class type: ${type}.`);
    }
    return blockClass;
  }

  /**
   * Registers an inline element class by type.
   * @param type - Type of the inline element class.
   * @param wordClass - Word class to register.
   */
  registerWordClass(type: string, wordClass: WordClass) {
    this.wordClasses.set(type, wordClass);
  }

  /**
   * Gets a registered inline element class by type.
   * @param type - Type of the inline element class.
   */
  getWordClass(type: string): WordClass {
    const wordClass = this.wordClasses.get(type);
    if (!wordClass) {
      throw new Error(`Unregistered inline element class type: ${type}.`);
    }
    return wordClass;
  }

  /**
   * Registers the document view class.
   * @param docViewClass - Document view class to register.
   */
  registerDocViewClass(docViewClass: DocViewClass) {
    this.docViewClass = docViewClass;
  }

  /**
   * Gets the registered document view class.
   */
  getDocViewClass(): DocViewClass {
    if (!this.docViewClass) {
      throw new Error('No document view class registered.');
    }
    return this.docViewClass;
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
   * @param wordViewType - Box view class to register.
   */
  registerWordViewClass(type: string, wordViewClass: WordViewClass) {
    this.wordViewClasses.set(type, wordViewClass);
  }

  /**
   * Gets a registered box view class by type.
   * @param type - Type of the box view class.
   */
  getWordViewClass(type: string): WordViewClass {
    const wordViewClass = this.wordViewClasses.get(type);
    if (!wordViewClass) {
      throw new Error(`Unregistered box view class: ${type}.`);
    }
    return wordViewClass;
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

  /**
   * Registers the document transformer.
   * @param documentTransformer - Document transformer to register.
   */
  registerDocumentTransformer(documentTransformer: DocumentTransformer) {
    this.documentTransformer = documentTransformer;
  }

  /**
   * Gets the registered document transformer.
   */
  getDocumentTransformer(): DocumentTransformer {
    if (!this.documentTransformer) {
      throw new Error('No document transformer registered.');
    }
    return this.documentTransformer;
  }

  /**
   * Registers an event handler.
   * @param eventObserver - Event handler to register.
   */
  registerEventObserver(eventObserver: EventObserver) {
    this.eventObservers.push(eventObserver)
  }

  /**
   * Gets all registered event handlers.
   */
  getEventObservers(): EventObserver[] {
    return this.eventObservers;
  }
}

/**
 * Root of TaleWeaver, holds things together.
 */
export default class TaleWeaver {
  private config: TaleWeaverConfig;
  private registry: TaleWeaverRegistry;
  private state?: State;
  private docView?: DocView;

  /**
   * Creates a new TaleWeaver instance.
   * @param config - Configs for TaleWeaver.
   */
  constructor(config: TaleWeaverConfig) {
    this.config = config;
    this.registry = new TaleWeaverRegistry(this);
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
   * @param docView - The document view to set.
   */
  setDocView(docView: DocView) {
    this.docView = docView;
  }

  /**
   * Gets the document view.
   */
  getDocView(): DocView {
    return this.docView!;
  }

  /**
   * Attaches TaleWeaver to the DOM.
   * @param domWrapper - Wrapper DOM element for TaleWeaver.
   */
  attach(domWrapper: HTMLElement) {
    const DocView = this.registry.getDocViewClass();
    const docView = new DocView(
      this,
      this.getState().getDoc(),
      {
        pageWidth: this.config.pageWidth,
        pageHeight: this.config.pageHeight,
        pagePaddingTop: this.config.pagePaddingTop,
        pagePaddingBottom: this.config.pagePaddingBottom,
        pagePaddingLeft: this.config.pagePaddingLeft,
        pagePaddingRight: this.config.pagePaddingRight,
      },
    );
    this.setDocView(docView);
    this.getDocView().mount(domWrapper);
  }
}
