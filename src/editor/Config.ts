import TaleWeaver from './TaleWeaver';
import Block from './treemodel/Block';
import Inline from './treemodel/Inline';
import Paragraph from './treemodel/Paragraph';
import Text from './treemodel/Text';
import WordViewModel from './viewmodel/WordViewModel';
import TextViewModel from './viewmodel/TextViewModel';
import LineView from './view/LineView';
import WordView from './view/WordView';
import ParagraphLineView from './view/ParagraphLineView';
import TextView from './view/TextView';
import EventObserver from './event/EventObserver';
import CursorTransformer from './state/CursorTransformer';
import DocTransformer from './state/DocumentTransformer';
import EditorCursorEventObserver from './event/EditorCursorEventObserver';
import DocumentEventObserver from './event/DocumentEventObserver';

type BlockClass = new (...args: any[]) => Block;
type InlineClass = new (...args: any[]) => Inline;
type WordViewModelClass = new (...args: any[]) => WordViewModel;
type LineViewClass = new (...args: any[]) => LineView;
type WordViewClass = new (...args: any[]) => WordView;

class Config {
  protected taleWeaver: TaleWeaver;
  protected blockClasses: { [key: string]: BlockClass };
  protected inlineClasses: { [key: string]: InlineClass };
  protected wordViewModelClasses: { [key: string]: WordViewModelClass };
  protected lineViewClasses: { [key: string]: LineViewClass };
  protected wordViewClasses: { [key: string]: WordViewClass };
  protected cursorTransformer: CursorTransformer;
  protected docTransformer: DocTransformer;
  protected eventObservers: EventObserver[];

  constructor(taleWeaver: TaleWeaver) {
    this.taleWeaver = taleWeaver;
    this.blockClasses = {};
    this.inlineClasses = {};
    this.wordViewModelClasses = {};
    this.lineViewClasses = {};
    this.wordViewClasses = {};
    this.eventObservers = [];
    this.registerBlockType('Paragraph', Paragraph, ParagraphLineView);
    this.registerInlineType('Text', Text, TextViewModel, TextView);
    this.cursorTransformer = new CursorTransformer();
    this.docTransformer = new DocTransformer();
    this.registerEventObserver(new EditorCursorEventObserver(taleWeaver));
    this.registerEventObserver(new DocumentEventObserver(taleWeaver));
  }

  registerBlockType(type: string, blockClass: BlockClass, lineViewClass: LineViewClass) {
    this.blockClasses[type] = blockClass;
    this.lineViewClasses[type] = lineViewClass;
  }

  registerInlineType(type: string, inlineClass: InlineClass, wordViewModelClass: WordViewModelClass, wordViewClass: WordViewClass) {
    this.inlineClasses[type] = inlineClass;
    this.wordViewModelClasses[type] = wordViewModelClass;
    this.wordViewClasses[type] = wordViewClass;
  }

  getBlockClass(type: string): BlockClass {
    const blockClass = this.blockClasses[type];
    if (!blockClass) {
      throw new Error(`Block type ${type} is not registered.`);
    }
    return blockClass
  }

  getInlineClass(type: string): InlineClass {
    const inlineClass = this.inlineClasses[type];
    if (!inlineClass) {
      throw new Error(`Inline type ${type} is not regsitered.`);
    }
    return inlineClass;
  }

  getWordViewModelClass(type: string): WordViewModelClass {
    const wordViewModelClass = this.wordViewModelClasses[type];
    if (!wordViewModelClass) {
      throw new Error(`Inline type ${type} is not regsitered.`);
    }
    return wordViewModelClass;
  }

  getLineViewClass(type: string): LineViewClass {
    const lineViewClass = this.lineViewClasses[type];
    if (!lineViewClass) {
      throw new Error(`Block type ${type} is not regsitered.`);
    }
    return lineViewClass;
  }

  getWordViewClass(type: string): WordViewClass {
    const wordViewClass = this.wordViewClasses[type];
    if (!wordViewClass) {
      throw new Error(`Inline type ${type} is not regsitered.`);
    }
    return wordViewClass;
  }

  getCursorTransformer(): CursorTransformer {
    return this.cursorTransformer;
  }

  getDocTransformer(): DocTransformer {
    return this.docTransformer;
  }

  registerEventObserver(eventObserver: EventObserver) {
    this.eventObservers.push(eventObserver)
  }

  getEventObservers(): EventObserver[] {
    return this.eventObservers;
  }
}

export default Config;
