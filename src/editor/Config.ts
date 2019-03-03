import Node from './model/Node';
import Paragraph from './model/Paragraph';
import Text from './model/Text';
import WordViewModel from './layout/WordViewModel';
import LineView from './view/LineView';
import WordView from './view/WordView';
import EventObserver from './event/EventObserver';
import EditorCursorEventObserver from './event/EditorCursorEventObserver';
import StateEventObserver from './event/StateEventObserver';
import Doc from './model/Doc';

type NodeClass = new (...args: any[]) => Node;
type WordViewModelClass = new (...args: any[]) => WordViewModel;
type LineViewClass = new (...args: any[]) => LineView;
type WordViewClass = new (...args: any[]) => WordView;
type EventObserverClass = new (...args: any[]) => EventObserver;

class Config {
  protected nodeClasses: Map<string, NodeClass>;
  protected wordViewModelClasses: { [key: string]: WordViewModelClass };
  protected lineViewClasses: { [key: string]: LineViewClass };
  protected wordViewClasses: { [key: string]: WordViewClass };
  protected eventObserverClasses: EventObserverClass[];

  constructor() {
    this.nodeClasses = new Map();
    this.wordViewModelClasses = {};
    this.lineViewClasses = {};
    this.wordViewClasses = {};
    this.eventObserverClasses = [];
    this.registerNodeType('Doc', Doc);
    this.registerNodeType('Paragraph', Paragraph);
    this.registerNodeType('Text', Text);
    this.registerEventObserverClass(EditorCursorEventObserver);
    this.registerEventObserverClass(StateEventObserver);
  }

  registerNodeType(type: string, nodeClass: NodeClass) {
    this.nodeClasses.set(type, nodeClass);
  }

  getNodeClass(type: string): NodeClass {
    if (!this.nodeClasses.has(type)) {
      throw new Error(`Node type ${type} is not registered.`);
    }
    return this.nodeClasses.get(type)!;
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

  registerEventObserverClass(eventObserverClass: EventObserverClass) {
    this.eventObserverClasses.push(eventObserverClass)
  }

  getEventObserverClasses(): EventObserverClass[] {
    return this.eventObserverClasses;
  }
}

export default Config;
