import Doc from './treemodel/Doc';
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

type BlockClass = new (...args: any[]) => Block;
type InlineClass = new (...args: any[]) => Inline;
type WordViewModelClass = new (...args: any[]) => WordViewModel;
type LineViewClass = new (...args: any[]) => LineView;
type WordViewClass = new (...args: any[]) => WordView;

class Config {
  protected blockClasses: { [key: string]: BlockClass };
  protected inlineClasses: { [key: string]: InlineClass };
  protected wordViewModelClasses: { [key: string]: WordViewModelClass };
  protected lineViewClasses: { [key: string]: LineViewClass };
  protected wordViewClasses: { [key: string]: WordViewClass };

  constructor() {
    this.blockClasses = {};
    this.inlineClasses = {};
    this.wordViewModelClasses = {};
    this.lineViewClasses = {};
    this.wordViewClasses = {};
    this.registerBlockType('Paragraph', Paragraph, ParagraphLineView);
    this.registerInlineType('Text', Text, TextViewModel, TextView);
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
}

export default Config;
