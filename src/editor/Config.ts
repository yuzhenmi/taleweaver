import Node from './model/Node';
import Doc from './model/Doc';
import Paragraph from './model/Paragraph';
import Text from './model/Text';
import RenderNode from './render/RenderNode';
import RenderDoc from './render/RenderDoc';
import RenderParagraph from './render/RenderParagraph';
import RenderText from './render/RenderText';
import LineView from './view/LineView';
import WordView from './view/WordView';
import EventObserver from './event/EventObserver';
import EditorCursorEventObserver from './event/EditorCursorEventObserver';
import StateEventObserver from './event/StateEventObserver';

type NodeClass = new (...args: any[]) => Node;
type RenderNodeClass = new (...args: any[]) => RenderNode;
type LineViewClass = new (...args: any[]) => LineView;
type WordViewClass = new (...args: any[]) => WordView;
type EventObserverClass = new (...args: any[]) => EventObserver;

class Config {
  protected nodeClasses: Map<string, NodeClass>;
  protected renderNodeClasses: Map<string, RenderNodeClass>;
  protected lineViewClasses: { [key: string]: LineViewClass };
  protected wordViewClasses: { [key: string]: WordViewClass };
  protected eventObserverClasses: EventObserverClass[];

  constructor() {
    this.nodeClasses = new Map();
    this.renderNodeClasses = new Map();
    this.lineViewClasses = {};
    this.wordViewClasses = {};
    this.eventObserverClasses = [];
    this.registerNodeClass('Doc', Doc);
    this.registerNodeClass('Paragraph', Paragraph);
    this.registerNodeClass('Text', Text);
    this.registerRenderNodeClass('Doc', RenderDoc);
    this.registerRenderNodeClass('Paragraph', RenderParagraph);
    this.registerRenderNodeClass('Text', RenderText);
    this.registerEventObserverClass(EditorCursorEventObserver);
    this.registerEventObserverClass(StateEventObserver);
  }

  registerNodeClass(type: string, nodeClass: NodeClass) {
    this.nodeClasses.set(type, nodeClass);
  }

  getNodeClass(type: string): NodeClass {
    if (!this.nodeClasses.has(type)) {
      throw new Error(`Node type ${type} is not registered.`);
    }
    return this.nodeClasses.get(type)!;
  }

  registerRenderNodeClass(type: string, renderNodeClass: RenderNodeClass) {
    this.renderNodeClasses.set(type, renderNodeClass);
  }

  getRenderNodeClass(type: string): RenderNodeClass {
    if (!this.renderNodeClasses.has(type)) {
      throw new Error(`Render node type ${type} is not registered.`);
    }
    return this.renderNodeClasses.get(type)!;
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
