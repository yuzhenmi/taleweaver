import Node from './model/Node';
import Paragraph from './model/Paragraph';
import Text from './model/Text';
import RenderNode from './render/RenderNode';
import ParagraphBlockRenderNode from './render/ParagraphBlockRenderNode';
import TextInlineRenderNode from './render/TextInlineRenderNode';
import Box from './layout/Box';
import ParagraphBlockBox from './layout/ParagraphBlockBox';
import TextInlineBox from './layout/TextInlineBox';
import ViewNode from './view/ViewNode';
import ParagraphBlockViewNode from './view/ParagraphBlockViewNode';
import TextInlineViewNode from './view/TextInlineViewNode';
import KeySignature from './input/KeySignature';

type NodeClass = new (...args: any[]) => Node;
type RenderNodeClass = new (...args: any[]) => RenderNode;
type BoxClass = new (...args: any[]) => Box;
type ViewNodeClass = new (...args: any[]) => ViewNode;
type KeyBindingHandler = () => void;

class Config {
  protected nodeClasses: Map<string, NodeClass>;
  protected renderNodeClasses: Map<string, RenderNodeClass>;
  protected boxClasses: Map<string, BoxClass>;
  protected viewNodeClasses: Map<string, ViewNodeClass>;
  protected keyBindings: Map<string, KeyBindingHandler[]>;

  constructor() {
    this.nodeClasses = new Map();
    this.renderNodeClasses = new Map();
    this.boxClasses = new Map();
    this.viewNodeClasses = new Map();
    this.keyBindings = new Map();
    this.registerNodeClass('Paragraph', Paragraph);
    this.registerNodeClass('Text', Text);
    this.registerRenderNodeClass('Paragraph', ParagraphBlockRenderNode);
    this.registerRenderNodeClass('Text', TextInlineRenderNode);
    this.registerBoxClass('ParagraphBlockRenderNode', ParagraphBlockBox);
    this.registerBoxClass('TextInlineRenderNode', TextInlineBox);
    this.registerViewNodeClass('ParagraphBlockBox', ParagraphBlockViewNode);
    this.registerViewNodeClass('TextInlineBox', TextInlineViewNode);
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

  registerRenderNodeClass(nodeType: string, renderNodeClass: RenderNodeClass) {
    this.renderNodeClasses.set(nodeType, renderNodeClass);
  }

  getRenderNodeClass(nodeType: string): RenderNodeClass {
    if (!this.renderNodeClasses.has(nodeType)) {
      throw new Error(`No render node class registered for node type ${nodeType}.`);
    }
    return this.renderNodeClasses.get(nodeType)!;
  }

  registerBoxClass(renderNodeType: string, boxClass: BoxClass) {
    this.boxClasses.set(renderNodeType, boxClass);
  }

  getBoxClass(renderNodeType: string): BoxClass {
    const blockBoxClass = this.boxClasses.get(renderNodeType);
    if (!blockBoxClass) {
      throw new Error(`No box class registered for render node type ${renderNodeType}.`);
    }
    return blockBoxClass;
  }

  registerViewNodeClass(boxType: string, viewNodeClass: ViewNodeClass) {
    this.viewNodeClasses.set(boxType, viewNodeClass);
  }

  getViewNodeClass(boxType: string): ViewNodeClass {
    const viewNodeClass = this.viewNodeClasses.get(boxType);
    if (!viewNodeClass) {
      throw new Error(`No view node class registered for box type ${boxType}.`);
    }
    return viewNodeClass;
  }

  bindKey(keySignature: KeySignature, subscriber: KeyBindingHandler) {
    const keySignatureCode = keySignature.getCode();
    if (!this.keyBindings.has(keySignatureCode)) {
      this.keyBindings.set(keySignatureCode, []);
    }
    const subscribers = this.keyBindings.get(keySignatureCode)!;
    subscribers.push(subscriber);
  }

  getKeyBindings() {
    return this.keyBindings;
  }
}

export default Config;
