import Node from './model/Node';
import Paragraph from './model/Paragraph';
import Text from './model/Text';
import RenderNodeBuilder from './render/RenderNodeBuilder';
import ParagraphBlockRenderNodeBuilder from './render/ParagraphBlockRenderNodeBuilder';
import TextInlineRenderNodeBuilder from './render/TextInlineRenderNodeBuilder';
import BlockBoxBuilder from './layout/BlockBoxBuilder';
import ParagraphBlockBoxBuilder from './layout/ParagraphBlockBoxBuilder';
import LineBoxBuilder from './layout/LineBoxBuilder';
import ParagraphLineBoxBuilder from './layout/ParagraphLineBoxBuilder';
import InlineBoxBuilder from './layout/InlineBoxBuilder';
import TextInlineBoxBuilder from './layout/TextInlineBoxBuilder';
import AtomicBoxBuilder from './layout/AtomicBoxBuilder';
import TextAtomicBoxBuilder from './layout/TextAtomicBoxBuilder';
import View from './view/View';
import EventObserver from './event/EventObserver';
import EditorCursorEventObserver from './event/EditorCursorEventObserver';
import StateEventObserver from './event/StateEventObserver';

type NodeClass = new (...args: any[]) => Node;
type ViewClass = new (...args: any[]) => View;
type EventObserverClass = new (...args: any[]) => EventObserver;

class Config {
  protected nodeClasses: Map<string, NodeClass>;
  protected renderers: Map<string, RenderNodeBuilder>;
  protected blockBoxBuilders: Map<string, BlockBoxBuilder>;
  protected lineBoxBuilders: Map<string, LineBoxBuilder>;
  protected inlineBoxBuilders: Map<string, InlineBoxBuilder>;
  protected atomicBoxBuilders: Map<string, AtomicBoxBuilder>;
  protected viewClasses: Map<string, ViewClass>;
  protected eventObserverClasses: EventObserverClass[];

  constructor() {
    this.nodeClasses = new Map();
    this.renderers = new Map();
    this.blockBoxBuilders = new Map();
    this.lineBoxBuilders = new Map();
    this.inlineBoxBuilders = new Map();
    this.atomicBoxBuilders = new Map();
    this.viewClasses = new Map();
    this.eventObserverClasses = [];
    this.registerNodeClass('Paragraph', Paragraph);
    this.registerNodeClass('Text', Text);
    this.registerRenderNodeBuilder('Paragraph', new ParagraphBlockRenderNodeBuilder());
    this.registerRenderNodeBuilder('Text', new TextInlineRenderNodeBuilder());
    this.registerBlockBoxBuilder('ParagraphBlockRenderNode', new ParagraphBlockBoxBuilder());
    this.registerLineBoxBuilder('ParagraphBlockRenderNode', new ParagraphLineBoxBuilder());
    this.registerInlineBoxBuilder('TextInlineRenderNode', new TextInlineBoxBuilder());
    this.registerAtomicBoxBuilder('TextAtomicRenderNode', new TextAtomicBoxBuilder());
    this.registerEventObserverClass(EditorCursorEventObserver);
    this.registerEventObserverClass(StateEventObserver);
  }

  registerNodeClass(nodeType: string, nodeClass: NodeClass) {
    this.nodeClasses.set(nodeType, nodeClass);
  }

  getNodeClass(nodeType: string): NodeClass {
    if (!this.nodeClasses.has(nodeType)) {
      throw new Error(`Node type ${nodeType} is not registered.`);
    }
    return this.nodeClasses.get(nodeType)!;
  }

  registerRenderNodeBuilder(nodeType: string, renderer: RenderNodeBuilder) {
    this.renderers.set(nodeType, renderer);
  }

  getRenderNodeBuilder(nodeType: string): RenderNodeBuilder {
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

  registerAtomicBoxBuilder(inlineRenderNodeType: string, atomicBoxBuilder: AtomicBoxBuilder) {
    this.atomicBoxBuilders.set(inlineRenderNodeType, atomicBoxBuilder);
  }

  getAtomicBoxBuilder(atomicRenderNodeType: string): AtomicBoxBuilder {
    const atomicBoxBuilder = this.atomicBoxBuilders.get(atomicRenderNodeType);
    if (!atomicBoxBuilder) {
      throw new Error(`No line box builder registered for atomic render node type ${atomicRenderNodeType}.`);
    }
    return atomicBoxBuilder;
  }

  registerViewClass(boxType: string, viewClass: ViewClass) {
    this.viewClasses.set(boxType, viewClass);
  }

  getViewClass(boxType: string): ViewClass {
    const viewClass = this.viewClasses.get(boxType);
    if (!viewClass) {
      throw new Error(`No view class registered for box type ${boxType}.`);
    }
    return viewClass;
  }

  registerEventObserverClass(eventObserverClass: EventObserverClass) {
    this.eventObserverClasses.push(eventObserverClass)
  }

  getEventObserverClasses(): EventObserverClass[] {
    return this.eventObserverClasses;
  }
}

export default Config;
