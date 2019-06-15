import Element from '../model/Element';
import Paragraph from '../model/Paragraph';
import Text from '../model/Text';
import RenderNode from '../render/RenderNode';
import ParagraphBlockRenderNode from '../render/ParagraphBlockRenderNode';
import TextInlineRenderNode from '../render/TextInlineRenderNode';
import Box from '../layout/Box';
import ParagraphBlockBox from '../layout/ParagraphBlockBox';
import TextInlineBox from '../layout/TextInlineBox';
import TextAtomicBox from '../layout/TextAtomicBox';
import ViewNode from '../view/ViewNode';
import ParagraphBlockViewNode from '../view/ParagraphBlockViewNode';
import TextInlineViewNode from '../view/TextInlineViewNode';

type ElementClass = new (...args: any[]) => Element;
type RenderNodeClass = new (...args: any[]) => RenderNode;
type BoxClass = new (...args: any[]) => Box;
type ViewNodeClass = new (...args: any[]) => ViewNode;

class ElementConfig {
  protected nodeClasses: Map<string, ElementClass> = new Map();
  protected renderNodeClasses: Map<string, RenderNodeClass> = new Map();
  protected boxClasses: Map<string, BoxClass> = new Map();
  protected viewNodeClasses: Map<string, ViewNodeClass> = new Map();

  constructor() {
    this.registerElementClass('Paragraph', Paragraph);
    this.registerElementClass('Text', Text);
    this.registerRenderNodeClass('Paragraph', ParagraphBlockRenderNode);
    this.registerRenderNodeClass('Text', TextInlineRenderNode);
    this.registerBoxClass('ParagraphBlockRenderNode', ParagraphBlockBox);
    this.registerBoxClass('TextInlineRenderNode', TextInlineBox);
    this.registerBoxClass('TextAtomicRenderNode', TextAtomicBox);
    this.registerViewNodeClass('ParagraphBlockBox', ParagraphBlockViewNode);
    this.registerViewNodeClass('TextInlineBox', TextInlineViewNode);
  }

  registerElementClass(elementType: string, nodeClass: ElementClass) {
    this.nodeClasses.set(elementType, nodeClass);
  }

  getElementClass(elementType: string): ElementClass {
    if (!this.nodeClasses.has(elementType)) {
      throw new Error(`Element type ${elementType} is not registered.`);
    }
    return this.nodeClasses.get(elementType)!;
  }

  registerRenderNodeClass(elementType: string, renderNodeClass: RenderNodeClass) {
    this.renderNodeClasses.set(elementType, renderNodeClass);
  }

  getRenderNodeClass(elementType: string): RenderNodeClass {
    if (!this.renderNodeClasses.has(elementType)) {
      throw new Error(`No render node class registered for element type ${elementType}.`);
    }
    return this.renderNodeClasses.get(elementType)!;
  }

  registerBoxClass(renderNodeType: string, boxClass: BoxClass) {
    this.boxClasses.set(renderNodeType, boxClass);
  }

  getBoxClass(renderNodeType: string): BoxClass {
    const blockBoxClass = this.boxClasses.get(renderNodeType);
    if (!blockBoxClass) {
      throw new Error(`No box class registered for render element type ${renderNodeType}.`);
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
}

export default ElementConfig;
