import Node from './model/Node';
import Paragraph from './model/Paragraph';
import Text from './model/Text';
import Renderer from './render/Renderer';
import ParagraphRenderer from './render/ParagraphRenderer';
import TextRenderer from './render/TextRenderer';
import BlockBoxBuilder from './layout/BlockBoxBuilder';
import ParagraphBlockBoxBuilder from './layout/ParagraphBlockBoxBuilder';
import LineBoxBuilder from './layout/LineBoxBuilder';
import ParagraphLineBoxBuilder from './layout/ParagraphLineBoxBuilder';
import InlineBoxBuilder from './layout/InlineBoxBuilder';
import TextInlineBoxBuilder from './layout/TextInlineBoxBuilder';
import LineView from './view/LineView';
import WordView from './view/WordView';
import EventObserver from './event/EventObserver';
import EditorCursorEventObserver from './event/EditorCursorEventObserver';
import StateEventObserver from './event/StateEventObserver';

type NodeClass = new (...args: any[]) => Node;
type LineViewClass = new (...args: any[]) => LineView;
type WordViewClass = new (...args: any[]) => WordView;
type EventObserverClass = new (...args: any[]) => EventObserver;

class Config {
  protected nodeClasses: Map<string, NodeClass>;
  protected renderers: Map<string, Renderer>;
  protected blockBoxBuilders: Map<string, BlockBoxBuilder>;
  protected lineBoxBuilders: Map<string, LineBoxBuilder>;
  protected inlineBoxBuilders: Map<string, InlineBoxBuilder>;
  protected lineViewClasses: { [key: string]: LineViewClass };
  protected wordViewClasses: { [key: string]: WordViewClass };
  protected eventObserverClasses: EventObserverClass[];

  constructor() {
    this.nodeClasses = new Map();
    this.renderers = new Map();
    this.blockBoxBuilders = new Map();
    this.lineBoxBuilders = new Map();
    this.inlineBoxBuilders = new Map();
    this.lineViewClasses = {};
    this.wordViewClasses = {};
    this.eventObserverClasses = [];
    this.registerNodeClass('Paragraph', Paragraph);
    this.registerNodeClass('Text', Text);
    this.registerRenderer('Paragraph', new ParagraphRenderer());
    this.registerRenderer('Text', new TextRenderer());
    this.registerBlockBoxBuilder('Paragraph', new ParagraphBlockBoxBuilder());
    this.registerLineBoxBuilder('Paragraph', new ParagraphLineBoxBuilder());
    this.registerInlineBoxBuilder('Text', new TextInlineBoxBuilder());
    this.registerEventObserverClass(EditorCursorEventObserver);
    this.registerEventObserverClass(StateEventObserver);
  }

  registerNodeClass(type: string, nodeClass: NodeClass) {
    this.nodeClasses.set(type, nodeClass);
  }

  getNodeClass(nodeType: string): NodeClass {
    if (!this.nodeClasses.has(nodeType)) {
      throw new Error(`Node type ${nodeType} is not registered.`);
    }
    return this.nodeClasses.get(nodeType)!;
  }

  registerRenderer(nodeType: string, renderer: Renderer) {
    this.renderers.set(nodeType, renderer);
  }

  getRenderer(nodeType: string): Renderer {
    if (!this.renderers.has(nodeType)) {
      throw new Error(`No renderer registered for node type ${nodeType}.`);
    }
    return this.renderers.get(nodeType)!;
  }

  registerBlockBoxBuilder(blockRenderNodeType: string, blockBoxBuilder: BlockBoxBuilder) {
    this.blockBoxBuilders.set(blockRenderNodeType, blockBoxBuilder);
  }

  getBlockBoxBuilder(blockRenderNodeType: string): BlockBoxBuilder {
    const blockBoxBuilder = this.blockBoxBuilders.get(blockRenderNodeType);
    if (!blockBoxBuilder) {
      throw new Error(`No block box builder registered for block render node type ${blockRenderNodeType}.`);
    }
    return blockBoxBuilder;
  }

  registerLineBoxBuilder(blockRenderNodeType: string, lineBoxBuilder: LineBoxBuilder) {
    this.lineBoxBuilders.set(blockRenderNodeType, lineBoxBuilder);
  }

  getLineBoxBuilder(blockRenderNodeType: string): LineBoxBuilder {
    const lineBoxBuilder = this.lineBoxBuilders.get(blockRenderNodeType);
    if (!lineBoxBuilder) {
      throw new Error(`No line box builder registered for block render node type ${blockRenderNodeType}.`);
    }
    return lineBoxBuilder;
  }

  registerInlineBoxBuilder(inlineRenderNodeType: string, inlineBoxBuilder: InlineBoxBuilder) {
    this.inlineBoxBuilders.set(inlineRenderNodeType, inlineBoxBuilder);
  }

  getInlineBoxBuilder(inlineRenderNodeType: string): InlineBoxBuilder {
    const inlineBoxBuilder = this.inlineBoxBuilders.get(inlineRenderNodeType);
    if (!inlineBoxBuilder) {
      throw new Error(`No line box builder registered for inline render node type ${inlineRenderNodeType}.`);
    }
    return inlineBoxBuilder;
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
