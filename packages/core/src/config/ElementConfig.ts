import Editor from '../Editor';
import Element from '../model/Element';
import Paragraph from '../model/Paragraph';
import Text from '../model/Text';
import BlockRenderNode from '../render/BlockRenderNode';
import InlineRenderNode from '../render/InlineRenderNode';
import ParagraphBlockRenderNode from '../render/ParagraphBlockRenderNode';
import TextInlineRenderNode from '../render/TextInlineRenderNode';
import BlockBox from '../layout/BlockBox';
import ParagraphBlockBox from '../layout/ParagraphBlockBox';
import TextInlineBox from '../layout/TextInlineBox';
import TextAtomicBox from '../layout/TextAtomicBox';
import BlockViewNode from '../view/BlockViewNode';
import InlineViewNode from '../view/InlineViewNode';
import ParagraphBlockViewNode from '../view/ParagraphBlockViewNode';
import TextInlineViewNode from '../view/TextInlineViewNode';
import InlineBox from '../layout/InlineBox';
import AtomicBox from '../layout/AtomicBox';

type ElementClass = new (editor: Editor) => Element;
type BlockRenderNodeClass = new (editor: Editor, id: string) => BlockRenderNode;
type InlineRenderNodeClass = new (editor: Editor, id: string) => InlineRenderNode;
type BlockBoxClass = new (editor: Editor, renderNodeId: string) => BlockBox;
type InlineBoxClass = new (editor: Editor, renderNodeId: string) => InlineBox;
type AtomicBoxClass = new (editor: Editor, renderNodeId: string) => AtomicBox;
type BlockViewNodeClass = new (edito: Editor, id: string) => BlockViewNode;
type InlineViewNodeClass = new (edito: Editor, id: string) => InlineViewNode;

class ElementConfig {
  protected elementClasses: Map<string, ElementClass> = new Map();
  protected blockRenderNodeClasses: Map<string, BlockRenderNodeClass> = new Map();
  protected inlineRenderNodeClasses: Map<string, InlineRenderNodeClass> = new Map();
  protected blockBoxClasses: Map<string, BlockBoxClass> = new Map();
  protected inlineBoxClasses: Map<string, InlineBoxClass> = new Map();
  protected atomicBoxClasses: Map<string, AtomicBoxClass> = new Map();
  protected blockViewNodeClasses: Map<string, BlockViewNodeClass> = new Map();
  protected inlineViewNodeClasses: Map<string, InlineViewNodeClass> = new Map();

  constructor() {
    this.registerElementClass('Paragraph', Paragraph);
    this.registerElementClass('Text', Text);
    this.registerBlockRenderNodeClass('Paragraph', ParagraphBlockRenderNode);
    this.registerInlineRenderNodeClass('Text', TextInlineRenderNode);
    this.registerBlockBoxClass('ParagraphBlockRenderNode', ParagraphBlockBox);
    this.registerInlineBoxClass('TextInlineRenderNode', TextInlineBox);
    this.registerAtomicBoxClass('TextAtomicRenderNode', TextAtomicBox);
    this.registerBlockViewNodeClass('ParagraphBlockBox', ParagraphBlockViewNode);
    this.registerInlineViewNodeClass('TextInlineBox', TextInlineViewNode);
  }

  registerElementClass(elementType: string, elementClass: ElementClass) {
    this.elementClasses.set(elementType, elementClass);
  }

  getElementClass(elementType: string) {
    if (!this.elementClasses.has(elementType)) {
      throw new Error(`Element type ${elementType} is not registered.`);
    }
    return this.elementClasses.get(elementType)!;
  }

  registerBlockRenderNodeClass(elementType: string, renderNodeClass: BlockRenderNodeClass) {
    this.blockRenderNodeClasses.set(elementType, renderNodeClass);
  }

  getBlockRenderNodeClass(elementType: string) {
    if (!this.blockRenderNodeClasses.has(elementType)) {
      throw new Error(`Block render node for element type ${elementType} is not registered.`);
    }
    return this.blockRenderNodeClasses.get(elementType)!;
  }

  registerInlineRenderNodeClass(elementType: string, renderNodeClass: InlineRenderNodeClass) {
    this.inlineRenderNodeClasses.set(elementType, renderNodeClass);
  }

  getInlineRenderNodeClass(elementType: string) {
    if (!this.inlineRenderNodeClasses.has(elementType)) {
      throw new Error(`Inline render node for element type ${elementType} is not registered.`);
    }
    return this.inlineRenderNodeClasses.get(elementType)!;
  }

  registerBlockBoxClass(renderNodeType: string, boxClass: BlockBoxClass) {
    this.blockBoxClasses.set(renderNodeType, boxClass);
  }

  getBlockBoxClass(renderNodeType: string) {
    if (!this.blockBoxClasses.has(renderNodeType)) {
      throw new Error(`Block box for render node type ${renderNodeType} is not registered.`);
    }
    return this.blockBoxClasses.get(renderNodeType)!;
  }

  registerInlineBoxClass(renderNodeType: string, boxClass: InlineBoxClass) {
    this.inlineBoxClasses.set(renderNodeType, boxClass);
  }

  getInlineBoxClass(renderNodeType: string) {
    if (!this.inlineBoxClasses.has(renderNodeType)) {
      throw new Error(`Inline box for render node type ${renderNodeType} is not registered.`);
    }
    return this.inlineBoxClasses.get(renderNodeType)!;
  }

  registerAtomicBoxClass(renderNodeType: string, boxClass: AtomicBoxClass) {
    this.atomicBoxClasses.set(renderNodeType, boxClass);
  }

  getAtomicBoxClass(renderNodeType: string) {
    if (!this.atomicBoxClasses.has(renderNodeType)) {
      throw new Error(`Atomic box for render node type ${renderNodeType} is not registered.`);
    }
    return this.atomicBoxClasses.get(renderNodeType)!;
  }

  registerBlockViewNodeClass(boxType: string, viewNodeClass: BlockViewNodeClass) {
    this.blockViewNodeClasses.set(boxType, viewNodeClass);
  }

  getBlockViewNodeClass(boxType: string) {
    if (!this.blockViewNodeClasses.has(boxType)) {
      throw new Error(`Block view node for box type ${boxType} is not registered.`);
    }
    return this.blockViewNodeClasses.get(boxType)!;
  }

  registerInlineViewNodeClass(boxType: string, viewNodeClass: InlineViewNodeClass) {
    this.inlineViewNodeClasses.set(boxType, viewNodeClass);
  }

  getInlineViewNodeClass(boxType: string) {
    if (!this.inlineViewNodeClasses.has(boxType)) {
      throw new Error(`Inline view node for box type ${boxType} is not registered.`);
    }
    return this.inlineViewNodeClasses.get(boxType)!;
  }
}

export default ElementConfig;
