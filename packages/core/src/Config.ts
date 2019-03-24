import Node from './model/Node';
import Paragraph from './model/Paragraph';
import Text from './model/Text';
import RenderNodeBuilder from './render/RenderNodeBuilder';
import ParagraphBlockRenderNodeBuilder from './render/ParagraphBlockRenderNodeBuilder';
import TextInlineRenderNodeBuilder from './render/TextInlineRenderNodeBuilder';
import BoxBuilder from './layout/BoxBuilder';
import ParagraphBlockBoxBuilder from './layout/ParagraphBlockBoxBuilder';
import TextInlineBoxBuilder from './layout/TextInlineBoxBuilder';
import View from './view/View';
import ParagraphBlockView from './view/ParagraphBlockView';
import TextInlineView from './view/TextInlineView';

type NodeClass = new (...args: any[]) => Node;
type ViewClass = new (...args: any[]) => View;

class Config {
  protected nodeClasses: Map<string, NodeClass>;
  protected renderers: Map<string, RenderNodeBuilder>;
  protected boxBuilders: Map<string, BoxBuilder>;
  protected viewClasses: Map<string, ViewClass>;

  constructor() {
    this.nodeClasses = new Map();
    this.renderers = new Map();
    this.boxBuilders = new Map();
    this.viewClasses = new Map();
    this.registerNodeClass('Paragraph', Paragraph);
    this.registerNodeClass('Text', Text);
    this.registerRenderNodeBuilder('Paragraph', new ParagraphBlockRenderNodeBuilder());
    this.registerRenderNodeBuilder('Text', new TextInlineRenderNodeBuilder());
    this.registerBoxBuilder('ParagraphBlockRenderNode', new ParagraphBlockBoxBuilder());
    this.registerBoxBuilder('TextInlineRenderNode', new TextInlineBoxBuilder());
    this.registerViewClass('ParagraphBlockBox', ParagraphBlockView);
    this.registerViewClass('TextInlineBox', TextInlineView);
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

  registerBoxBuilder(renderNodeType: string, boxBuilder: BoxBuilder) {
    this.boxBuilders.set(renderNodeType, boxBuilder);
  }

  getBoxBuilder(renderNodeType: string): BoxBuilder {
    const blockBoxBuilder = this.boxBuilders.get(renderNodeType);
    if (!blockBoxBuilder) {
      throw new Error(`No box builder registered for render node type ${renderNodeType}.`);
    }
    return blockBoxBuilder;
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
}

export default Config;
